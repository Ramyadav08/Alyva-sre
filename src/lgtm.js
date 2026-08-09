// Extended LGTM client — builds on the verified starter/lgtm-client.js shape
// (same 3 backends, same X-Scope-OrgID header) with the extra query shapes the
// Alert Rules skill needs: range queries for backtesting, label discovery, and
// a couple of small conveniences. Nothing here writes anything — read-only,
// same as the starter kit.

const MIMIR_URL = process.env.MANAGED_MIMIR_URL || "http://10.10.1.139:9009";
const LOKI_URL = process.env.MANAGED_LOKI_URL || "http://10.10.1.139:3100";
const TEMPO_URL = process.env.MANAGED_TEMPO_URL || "http://10.10.1.139:3200";
const ORG_ID = process.env.MANAGED_LGTM_ORG_ID || "hackathon";

const headers = { "X-Scope-OrgID": ORG_ID };

async function get(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// ---- Mimir (metrics) ----

async function queryMetric(promql, time) {
  const t = time ? `&time=${time}` : "";
  return get(`${MIMIR_URL}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}${t}`);
}

async function queryMetricRange(promql, startSec, endSec, stepSec = 60) {
  const url =
    `${MIMIR_URL}/prometheus/api/v1/query_range?query=${encodeURIComponent(promql)}` +
    `&start=${startSec}&end=${endSec}&step=${stepSec}`;
  return get(url);
}

async function listMetricNames() {
  return get(`${MIMIR_URL}/prometheus/api/v1/label/__name__/values`);
}

async function listLabelValues(label) {
  return get(`${MIMIR_URL}/prometheus/api/v1/label/${encodeURIComponent(label)}/values`);
}

async function querySeries(matchExpr) {
  return get(`${MIMIR_URL}/prometheus/api/v1/series?match[]=${encodeURIComponent(matchExpr)}`);
}

// ---- Loki (logs) ----

async function queryLogs(logqlSelector, sinceMinutes = 10, limit = 100) {
  const start = (Date.now() - sinceMinutes * 60 * 1000) * 1e6; // ns
  const url =
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logqlSelector)}` +
    `&start=${start}&limit=${limit}`;
  return get(url);
}

async function queryLogsRange(logqlSelector, startMs, endMs, limit = 1000) {
  const url =
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logqlSelector)}` +
    `&start=${startMs * 1e6}&end=${endMs * 1e6}&limit=${limit}`;
  return get(url);
}

async function listLokiLabelValues(label) {
  return get(`${LOKI_URL}/loki/api/v1/label/${encodeURIComponent(label)}/values`);
}

// ---- Tempo (traces) ----

async function searchTraces(tagFilter, limit = 5) {
  return get(`${TEMPO_URL}/api/search?tags=${encodeURIComponent(tagFilter)}&limit=${limit}`);
}

async function searchTracesRange(tagFilter, startSec, endSec, limit = 20) {
  const url =
    `${TEMPO_URL}/api/search?tags=${encodeURIComponent(tagFilter)}` +
    `&start=${startSec}&end=${endSec}&limit=${limit}`;
  return get(url);
}

function otlpAttr(attributes, key) {
  const a = (attributes || []).find((x) => x.key === key);
  if (!a) return null;
  const v = a.value || {};
  return v.stringValue ?? v.intValue ?? v.boolValue ?? v.doubleValue ?? null;
}

/**
 * Fetches a specific trace's full span detail and distills it down to just
 * the signal that matters — which spans errored, in which service, with
 * what message — instead of dumping the raw OTLP (a real trace can carry
 * 80+ spans, most of them uninteresting). This is what makes RCA concrete:
 * a trace ID alone tells you nothing; the actual error message inside one
 * of its spans is the real evidence.
 */
async function getTraceDetail(traceId) {
  const url = `${TEMPO_URL}/api/traces/${traceId}`;
  const body = await get(url);
  const spans = [];
  for (const batch of body.batches || []) {
    const serviceName = otlpAttr(batch.resource?.attributes, "service.name");
    for (const scope of batch.scopeSpans || []) {
      for (const span of scope.spans || []) {
        spans.push({
          service_name: serviceName,
          span_name: span.name,
          status_code: span.status?.code || "STATUS_CODE_UNSET",
          status_message: span.status?.message || null,
          duration_ms: (Number(span.endTimeUnixNano) - Number(span.startTimeUnixNano)) / 1e6,
        });
      }
    }
  }
  const errorSpans = spans.filter((s) => s.status_code === "STATUS_CODE_ERROR");
  return {
    trace_id: traceId,
    total_spans: spans.length,
    error_span_count: errorSpans.length,
    services_involved: [...new Set(spans.map((s) => s.service_name))],
    error_spans: errorSpans,
  };
}

// ---- Derived helpers (built from the raw queries above, still read-only) ----

/**
 * Real service inventory + real criticality — pulled from the
 * `service_criticality` resource attribute the target app already exports on
 * traces_span_metrics_calls_total. Services with no criticality label are
 * returned with criticality: null — that's the actual signal for "ask a
 * human", not a default we invent.
 */
async function discoverServices() {
  const series = await querySeries("traces_span_metrics_calls_total");
  const byService = new Map();
  for (const s of series.data) {
    const name = s.service_name;
    if (!name) continue;
    if (!byService.has(name)) {
      byService.set(name, { service_name: name, service_criticality: s.service_criticality ?? null });
    } else if (!byService.get(name).service_criticality && s.service_criticality) {
      byService.get(name).service_criticality = s.service_criticality;
    }
  }
  return [...byService.values()].sort((a, b) => a.service_name.localeCompare(b.service_name));
}

module.exports = {
  MIMIR_URL,
  LOKI_URL,
  TEMPO_URL,
  ORG_ID,
  queryMetric,
  queryMetricRange,
  listMetricNames,
  listLabelValues,
  querySeries,
  queryLogs,
  queryLogsRange,
  listLokiLabelValues,
  searchTraces,
  searchTracesRange,
  getTraceDetail,
  discoverServices,
};
