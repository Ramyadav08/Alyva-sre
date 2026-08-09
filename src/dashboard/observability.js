// Raw observability primitives — real metrics/traces/logs, no derived
// business logic. This environment is Docker Compose (container_runtime:
// "docker" on every container series), NOT Kubernetes — there's no
// node/namespace/pod concept and no restart-count metric. The entity
// selector below is honest about that: it offers real service_name and
// container_name values (whichever exist for a given entity), never a
// fabricated pod-status field.

const lgtm = require("../lgtm");
const { traceLatencyP99Query, traceErrorRateQuery } = require("../shared/queries");

/**
 * Real entity list for the dashboard's filter dropdown — the union of real
 * discovered services (have traces/latency/error-rate) and real containers
 * (have CPU/memory), each flagged with what's actually queryable for it. No
 * node/namespace/pod dimension exists in this environment; this IS the
 * honest equivalent, not a placeholder for one.
 */
async function listEntities() {
  const [services, containerSeries] = await Promise.all([lgtm.discoverServices(), lgtm.querySeries("container_cpu_utilization_ratio")]);
  const serviceNames = new Set(services.map((s) => s.service_name));
  const containerNames = new Set(containerSeries.data.map((s) => s.container_name).filter(Boolean));
  const all = new Set([...serviceNames, ...containerNames]);
  return [...all].sort().map((name) => ({ name, has_service_metrics: serviceNames.has(name), has_container_metrics: containerNames.has(name) }));
}

async function topContainersByCpu(limit = 10) {
  const result = await lgtm.queryMetric(`topk(${limit}, avg by(container_name)(container_cpu_utilization_ratio))`);
  return (result.data?.result || []).map((r) => ({ container_name: r.metric.container_name, cpu_utilization_ratio: Number(r.value[1]) }));
}

async function topContainersByMemory(limit = 10) {
  const result = await lgtm.queryMetric(`topk(${limit}, avg by(container_name)(container_memory_percent_ratio))`);
  return (result.data?.result || []).map((r) => ({ container_name: r.metric.container_name, memory_percent: Number(r.value[1]) }));
}

/**
 * Single-entity time-series view for the metrics dashboard when a specific
 * entity is selected (rather than "All", which shows the top-N ranking).
 * Pulls whatever signals are real for that entity — CPU/memory if it's a
 * real container, latency/error-rate if it's a real traced service — and
 * says explicitly which it found, rather than silently showing zeros for a
 * signal that was never real for that entity.
 */
async function entityMetricsTimeseries(entityName, rangeMinutes = 60) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeMinutes * 60;
  const step = Math.max(30, Math.round((rangeMinutes * 60) / 60));

  const [cpu, memory, latency, errorRate] = await Promise.all([
    lgtm.queryMetricRange(`avg(container_cpu_utilization_ratio{container_name="${entityName}"})`, start, end, step).catch(() => null),
    lgtm.queryMetricRange(`avg(container_memory_percent_ratio{container_name="${entityName}"})`, start, end, step).catch(() => null),
    lgtm.queryMetricRange(traceLatencyP99Query(entityName, Math.max(5, Math.round(rangeMinutes / 10))), start, end, step).catch(() => null),
    lgtm.queryMetricRange(traceErrorRateQuery(entityName, Math.max(5, Math.round(rangeMinutes / 10))), start, end, step).catch(() => null),
  ]);

  const series = (r) => (r?.data?.result?.[0]?.values || []).map(([ts, v]) => ({ ts: Number(ts), value: Number(v) }));
  return {
    entity: entityName,
    range_minutes: rangeMinutes,
    cpu: series(cpu),
    memory: series(memory),
    latency_p99_ms: series(latency),
    error_rate: series(errorRate),
  };
}

/**
 * "Recently failed" — real signal, not a fabricated pod-status field: any
 * scrape target currently reporting up==0 (genuinely down), cross-referenced
 * with each known service's current error rate so a real spike is visible
 * too. This is honest about what Docker Compose + Prometheus can actually
 * tell you, which is not the same as a Kubernetes pod-restart event.
 */
async function recentlyUnhealthy() {
  const [upResult, discovered] = await Promise.all([lgtm.queryMetric("up == 0"), lgtm.discoverServices()]);
  const down = (upResult.data?.result || []).map((r) => ({ job: r.metric.job || r.metric.instance, reason: "scrape target reporting down (up == 0)" }));

  const errorChecks = await Promise.all(
    discovered.map(async (svc) => {
      try {
        const r = await lgtm.queryMetric(traceErrorRateQuery(svc.service_name, 5));
        const value = Number(r.data?.result?.[0]?.value?.[1]);
        return Number.isFinite(value) && value > 0.05 ? { service_name: svc.service_name, error_rate: value, reason: "error rate > 5% in the last 5m" } : null;
      } catch {
        return null;
      }
    })
  );

  return { down_scrape_targets: down, elevated_error_rate: errorChecks.filter(Boolean) };
}

async function recentTracesAcrossServices(limit = 10, { serviceFilter = null, rangeMinutes = 15 } = {}) {
  const discovered = await lgtm.discoverServices();
  const targets = serviceFilter ? discovered.filter((s) => s.service_name === serviceFilter) : discovered.slice(0, 8);
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeMinutes * 60;
  const results = [];
  for (const svc of targets) {
    try {
      const r = serviceFilter
        ? await lgtm.searchTracesRange(`service.name=${svc.service_name}`, start, end, limit)
        : await lgtm.searchTraces(`service.name=${svc.service_name}`, 2);
      for (const t of r.traces || []) {
        results.push({ trace_id: t.traceID, service_name: svc.service_name, root_trace_name: t.rootTraceName, duration_ms: t.durationMs });
      }
    } catch {
      // best-effort
    }
  }
  return results.slice(0, limit);
}

/**
 * Extracts the real "body" field from an OTel-shaped JSON log line before
 * truncating — truncating the raw line first (as this used to do) cuts the
 * JSON off mid-object, so it never parses and the UI falls back to showing
 * mangled raw JSON. Parse first, truncate the human-readable message after.
 */
function extractLogBody(rawLine) {
  try {
    const parsed = JSON.parse(rawLine);
    return typeof parsed.body === "string" ? parsed.body : rawLine;
  } catch {
    return rawLine;
  }
}

async function recentErrorLogs(limit = 10, { serviceFilter = null, rangeMinutes = 15 } = {}) {
  const selector = serviceFilter ? `{level="ERROR", service_name=~".*${serviceFilter}.*"}` : '{level="ERROR"}';
  const result = await lgtm.queryLogs(selector, rangeMinutes, limit);
  const streams = result.data?.result || [];
  const lines = [];
  for (const s of streams) {
    for (const [ts, line] of s.values || []) {
      lines.push({ service_name: s.stream?.service_name, ts: Number(ts) / 1e9, line: extractLogBody(line).slice(0, 300) });
    }
  }
  lines.sort((a, b) => b.ts - a.ts);
  return lines.slice(0, limit);
}

module.exports = {
  listEntities,
  topContainersByCpu,
  topContainersByMemory,
  entityMetricsTimeseries,
  recentlyUnhealthy,
  recentTracesAcrossServices,
  recentErrorLogs,
};
