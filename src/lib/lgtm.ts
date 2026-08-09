/**
 * Query-only client for the shared hackathon LGTM stack (Mimir/Loki/Tempo).
 *
 * Ported from ../../starter/lgtm-client.js (the verified zero-dependency
 * starter) and extended to match the *shape* of
 * reference/sreoncall/packages/api/src/services/lgtm-query.service.ts —
 * specifically `getServiceTrafficEdges` (parses real Tempo spans into a
 * service dependency graph with request count / avg latency / error count
 * per edge), which is exactly the "top services by inter-service call
 * latency" data the dashboard needs.
 *
 * Resilience pattern copied from that same reference file: every exported
 * function catches its own errors and returns a safe empty/null value —
 * nothing here ever throws to the caller. This is a read-only client; it
 * has no function that could mute, disable, or otherwise write to the
 * collector/flagd — see the hard self-blinding rule in the plan.
 */

const MIMIR_URL = process.env.MANAGED_MIMIR_URL ?? "http://10.10.1.139:9009";
const LOKI_URL = process.env.MANAGED_LOKI_URL ?? "http://10.10.1.139:3100";
const TEMPO_URL = process.env.MANAGED_TEMPO_URL ?? "http://10.10.1.139:3200";
const ORG_ID = process.env.MANAGED_LGTM_ORG_ID ?? "hackathon";

const HEADERS = { "X-Scope-OrgID": ORG_ID };

async function safeFetchJson(url: string, label: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[lgtm] ${label} returned ${res.status}: ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[lgtm] ${label} failed:`, (err as Error).message);
    return null;
  }
}

export type MetricVectorEntry = { metric: Record<string, string>; value: number };

/** Instant PromQL query, first scalar result (or null on no data / failure). */
export async function queryMetricInstant(promql: string, time?: number): Promise<number | null> {
  const t = time ? `&time=${time}` : "";
  const json = await safeFetchJson(
    `${MIMIR_URL}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}${t}`,
    "queryMetricInstant",
  );
  const result = json?.data?.result?.[0]?.value?.[1];
  if (result === undefined) return null;
  const num = Number(result);
  // Prometheus returns the literal string "NaN" for e.g. histogram_quantile
  // over empty buckets (confirmed live: payment/checkout's p99 latency
  // with near-zero call volume) — that's "no real value," not a number,
  // and must never be surfaced as evidence (Auditability: a claim can't
  // cite NaN as if it were a measurement).
  return Number.isNaN(num) ? null : num;
}

/** Instant PromQL query, full vector (all label combinations). */
export async function queryInstantVector(promql: string, time?: number): Promise<MetricVectorEntry[]> {
  const t = time ? `&time=${time}` : "";
  const json = await safeFetchJson(
    `${MIMIR_URL}/prometheus/api/v1/query?query=${encodeURIComponent(promql)}${t}`,
    "queryInstantVector",
  );
  const result = json?.data?.result;
  if (!Array.isArray(result)) return [];
  return result.map((r: any) => ({ metric: r.metric ?? {}, value: Number(r.value?.[1] ?? NaN) }));
}

/** Range PromQL query over [startTime, endTime] (unix seconds). */
export async function queryMetricsRange(
  promql: string,
  startTime: number,
  endTime: number,
  step = "60s",
): Promise<Array<{ metric: Record<string, string>; values: Array<[number, string]> }>> {
  const json = await safeFetchJson(
    `${MIMIR_URL}/prometheus/api/v1/query_range?query=${encodeURIComponent(promql)}&start=${startTime}&end=${endTime}&step=${step}`,
    "queryMetricsRange",
  );
  return Array.isArray(json?.data?.result) ? json.data.result : [];
}

/** All metric names currently available — used during discovery. */
export async function listMetricNames(): Promise<string[]> {
  const json = await safeFetchJson(
    `${MIMIR_URL}/prometheus/api/v1/label/__name__/values`,
    "listMetricNames",
  );
  return Array.isArray(json?.data) ? json.data : [];
}

/** Mimir series lookup — matching label sets for a selector. */
export async function querySeries(
  match: string,
  startTime?: number,
  endTime?: number,
): Promise<Record<string, string>[]> {
  const range = startTime && endTime ? `&start=${startTime}&end=${endTime}` : "";
  const json = await safeFetchJson(
    `${MIMIR_URL}/prometheus/api/v1/series?match[]=${encodeURIComponent(match)}${range}`,
    "querySeries",
  );
  return Array.isArray(json?.data) ? json.data : [];
}

let cachedLokiServiceLabels: string[] | null = null;

/**
 * Loki's `service_name` label uses `opentelemetry-demo/<service>` on this
 * stack (confirmed via the label-values endpoint, matches Ramya's
 * lokiServiceLabel() convention exactly) — resolves to that label value, or
 * null if this service has no Loki stream at all (some services, e.g.
 * pure gRPC backends with structured-logging-to-stdout-only, may not).
 */
export async function resolveLokiServiceLabel(serviceName: string): Promise<string | null> {
  if (!cachedLokiServiceLabels) {
    const json = await safeFetchJson(`${LOKI_URL}/loki/api/v1/label/service_name/values`, "resolveLokiServiceLabel");
    cachedLokiServiceLabels = (Array.isArray(json?.data) ? json.data : []) as string[];
  }
  const labels: string[] = cachedLokiServiceLabels;
  const candidate = `opentelemetry-demo/${serviceName}`;
  return labels.includes(candidate) ? candidate : null;
}

export type LogEntry = { timestamp: string; line: string; labels: Record<string, string> };

/** Loki range query, most recent `sinceMinutes` of logs matching a LogQL selector. */
export async function queryLogs(logqlSelector: string, sinceMinutes = 10, limit = 200): Promise<LogEntry[]> {
  const startNs = (Date.now() - sinceMinutes * 60_000) * 1_000_000;
  const json = await safeFetchJson(
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logqlSelector)}&start=${startNs}&limit=${limit}`,
    "queryLogs",
  );
  const streams = json?.data?.result;
  if (!Array.isArray(streams)) return [];
  const entries: LogEntry[] = [];
  for (const stream of streams) {
    for (const [ts, line] of stream.values ?? []) {
      entries.push({ timestamp: ts, line, labels: stream.stream ?? {} });
    }
  }
  return entries;
}

/**
 * Loki also evaluates LogQL *metric* queries (e.g. `sum(count_over_time(...))`),
 * distinct from the raw-log-lines `query_range` above — these hit Loki's
 * `/query` (instant) and `/query_range` (range) endpoints and return a
 * Prometheus-shaped vector/matrix, not log entries. Needed for
 * log_error_rate baselining/backtesting (queries.js's third signal type).
 */
export async function queryLokiMetricInstant(logqlMetricQuery: string, timeNs?: number): Promise<number | null> {
  const t = timeNs ? `&time=${timeNs}` : "";
  const json = await safeFetchJson(
    `${LOKI_URL}/loki/api/v1/query?query=${encodeURIComponent(logqlMetricQuery)}${t}`,
    "queryLokiMetricInstant",
  );
  const result = json?.data?.result?.[0]?.value?.[1];
  return result !== undefined ? Number(result) : null;
}

/** startNs/endNs are nanosecond epoch timestamps — Loki's own convention (verified in queryLogs above), distinct from Mimir's second-epoch range queries. */
export async function queryLokiMetricRange(
  logqlMetricQuery: string,
  startNs: number,
  endNs: number,
  step = "60s",
): Promise<Array<[number, string]>> {
  const json = await safeFetchJson(
    `${LOKI_URL}/loki/api/v1/query_range?query=${encodeURIComponent(logqlMetricQuery)}&start=${startNs}&end=${endNs}&step=${step}`,
    "queryLokiMetricRange",
  );
  return json?.data?.result?.[0]?.values ?? [];
}

/** Tempo trace search by tag filter (e.g. `service.name=checkout`). Returns trace summaries. */
export async function searchTraces(tagFilter: string, limit = 20): Promise<any[]> {
  const json = await safeFetchJson(
    `${TEMPO_URL}/api/search?tags=${encodeURIComponent(tagFilter)}&limit=${limit}`,
    "searchTraces",
  );
  return Array.isArray(json?.traces) ? json.traces : [];
}

/** Full trace fetch — resourceSpans, needed to walk parent/child relationships. */
async function fetchFullTrace(traceId: string): Promise<any | null> {
  return safeFetchJson(`${TEMPO_URL}/api/traces/${traceId}`, "fetchFullTrace");
}

const TRACE_FETCH_BATCH_SIZE = 10;

/**
 * Fetches full traces in small sequential batches instead of one giant
 * Promise.all — this stack's Tempo is shared with other teams, and firing
 * up to 150 concurrent full-trace fetches (the previous behavior) really
 * did trigger real HTTP 429s from Tempo during this session's testing,
 * confirmed via live logs, not assumed. Being a considerate citizen of
 * shared infra matters here as much as any other correctness property.
 */
async function fetchFullTracesBatched(traceIds: string[]): Promise<Array<any | null>> {
  const results: Array<any | null> = [];
  for (let i = 0; i < traceIds.length; i += TRACE_FETCH_BATCH_SIZE) {
    const batch = traceIds.slice(i, i + TRACE_FETCH_BATCH_SIZE);
    results.push(...(await Promise.all(batch.map((id) => fetchFullTrace(id)))));
  }
  return results;
}

export type TrafficEdge = {
  source: string;
  target: string;
  requestCount: number;
  avgLatencyMs: number;
  errorCount: number;
};

/**
 * Real, live-confirmed failure mode (not a hypothetical): the dashboard's
 * panels each poll independently every 5-15s (BusinessImpactPanel,
 * TopLatencyPanel, RecommendationsRunner, etc.), and every one of them
 * ultimately calls this function. On page load they all fire within the
 * same tick — three concurrent callers each launching their own 80-trace
 * batched fetch overlapped into ~30 simultaneous Tempo requests and every
 * single one aborted on timeout (confirmed live against the shared stack).
 * The batching fix alone (below) caps concurrency *within* one caller; it
 * does nothing about *multiple* callers racing. The correct fix is request
 * coalescing: concurrent/near-concurrent callers asking for the same
 * (windowMinutes, traceLimit) share one real in-flight query and its
 * result for a short TTL, instead of each re-querying Tempo from scratch.
 * This doesn't change what's true (Observability) — it's the same live
 * result, just not recomputed if it's under 20s old, matching the
 * dashboard's own fastest poll interval so no panel ever sees data staler
 * than it already tolerates by polling that slowly in the first place.
 */
const TRAFFIC_EDGES_CACHE_TTL_MS = 20_000;
const trafficEdgesCache = new Map<string, { at: number; promise: Promise<TrafficEdge[]> }>();

/**
 * Discovers real service-to-service call relationships + latency by walking
 * actual Tempo spans (not a hardcoded topology). This is the primary data
 * source for the dashboard's "top services by inter-service call latency"
 * panel, and for onboarding's dependency-graph discovery.
 */
export async function getServiceTrafficEdges(windowMinutes = 60, traceLimit = 80): Promise<TrafficEdge[]> {
  const cacheKey = `${windowMinutes}:${traceLimit}`;
  const cached = trafficEdgesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TRAFFIC_EDGES_CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = fetchServiceTrafficEdges(traceLimit);
  trafficEdgesCache.set(cacheKey, { at: Date.now(), promise });
  // A failed fetch should not poison the cache for the full TTL — let the
  // next caller retry for real rather than replaying a known-bad result.
  promise.catch(() => trafficEdgesCache.delete(cacheKey));
  return promise;
}

async function fetchServiceTrafficEdges(traceLimit: number): Promise<TrafficEdge[]> {
  const traces = await searchTraces("", traceLimit);
  const edgeKey = (a: string, b: string) => `${a}→${b}`;
  const edges = new Map<string, TrafficEdge>();

  const fullTraces = await fetchFullTracesBatched(traces.slice(0, traceLimit).map((t: any) => t.traceID));

  for (const trace of fullTraces) {
    if (!trace) continue;
    const batches = trace.batches ?? trace.resourceSpans ?? [];
    // spanId -> { service, startNs, endNs, isError }
    const spanIndex = new Map<
      string,
      { service: string; startNs: number; endNs: number; isError: boolean; parentSpanId?: string }
    >();

    for (const batch of batches) {
      const serviceName =
        batch.resource?.attributes?.find((a: any) => a.key === "service.name")?.value?.stringValue ??
        "unknown-service";
      for (const scopeSpans of batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? []) {
        for (const span of scopeSpans.spans ?? []) {
          const startNs = Number(span.startTimeUnixNano ?? 0);
          const endNs = Number(span.endTimeUnixNano ?? 0);
          const isError = span.status?.code === 2 || span.status?.code === "STATUS_CODE_ERROR";
          spanIndex.set(span.spanId, {
            service: serviceName,
            startNs,
            endNs,
            isError,
            parentSpanId: span.parentSpanId,
          });
        }
      }
    }

    for (const [, span] of spanIndex) {
      if (!span.parentSpanId) continue;
      const parent = spanIndex.get(span.parentSpanId);
      if (!parent || parent.service === span.service) continue; // only cross-service edges
      const durationMs = Math.max(0, (span.endNs - span.startNs) / 1_000_000);
      const key = edgeKey(parent.service, span.service);
      const existing = edges.get(key);
      if (existing) {
        const totalMs = existing.avgLatencyMs * existing.requestCount + durationMs;
        existing.requestCount += 1;
        existing.avgLatencyMs = totalMs / existing.requestCount;
        if (span.isError) existing.errorCount += 1;
      } else {
        edges.set(key, {
          source: parent.service,
          target: span.service,
          requestCount: 1,
          avgLatencyMs: durationMs,
          errorCount: span.isError ? 1 : 0,
        });
      }
    }
  }

  return Array.from(edges.values()).sort((a, b) => b.avgLatencyMs - a.avgLatencyMs);
}

/**
 * Real resource attribute this stack's OTel Demo already emits on some
 * services' span-metrics ("service_criticality": critical|high|medium|low)
 * — confirmed present for most services (checkout/frontend/payment=critical,
 * cart/currency/shipping/product-catalog=high, etc.), absent for a few
 * (frontend-web, image-provider, telemetry-docs). Ported from Ramya's
 * discoverServices() in src/lgtm.js, which uses this as its sole criticality
 * source. Real telemetry, not a guess — when present, this is strictly
 * better evidence than asking a human to reclassify from scratch, so
 * onboarding's interview step is given this as evidence rather than
 * skipped entirely (the label alone doesn't give owning team or revenue
 * $ figures, which still need a real answer).
 */
export async function getServiceCriticalityLabel(serviceName: string): Promise<string | null> {
  const escaped = serviceName.replace(/"/g, '\\"');
  const vector = await queryInstantVector(`traces_span_metrics_calls_total{service_name="${escaped}"}`);
  for (const entry of vector) {
    const label = entry.metric.service_criticality;
    if (label) return label;
  }
  return null;
}

export type ServiceHealth = {
  errorRatePercent: number | null;
  latencyP95Ms: number | null;
  latencyP99Ms: number | null;
  lastUpdatedAt: string;
};

/**
 * Per-service health from span-metrics (`traces_span_metrics_*`), not the
 * HTTP-server metric family. This was a real, confirmed bug, not a
 * defensive guess: `payment` (a pure gRPC backend, no HTTP server at all)
 * has zero `http_server_request_duration_seconds_*` series — so the
 * previous HTTP-only version could never see it, or any other backend
 * service with no inbound HTTP listener. `traces_span_metrics_*` is
 * derived from spans by the OTel Collector's span-metrics connector and
 * exists for every instrumented service regardless of transport (HTTP or
 * gRPC) — verified present for all 18 real services on this stack. Same
 * metric family and error query Ramya's alert-rules skill uses
 * (src/skills/alert-rules/queries.js) — kept consistent on purpose so
 * onboarding's live-health check and Milestone 2's baseline/backtest
 * agree on what "the error rate" means for a given service.
 */
export async function getServiceHealth(serviceName: string): Promise<ServiceHealth> {
  const escaped = serviceName.replace(/"/g, '\\"');
  const [p95, p99, errorRate] = await Promise.all([
    queryMetricInstant(
      `histogram_quantile(0.95, sum(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${escaped}"}[5m])) by (le))`,
    ),
    queryMetricInstant(
      `histogram_quantile(0.99, sum(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${escaped}"}[5m])) by (le))`,
    ),
    queryMetricInstant(
      `100 * sum(rate(traces_span_metrics_calls_total{service_name="${escaped}",status_code="STATUS_CODE_ERROR"}[5m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="${escaped}"}[5m])), 0.0001)`,
    ),
  ]);
  return {
    errorRatePercent: errorRate,
    latencyP95Ms: p95,
    latencyP99Ms: p99,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Tempo emits this literal placeholder as `rootServiceName` when a trace's
 * root span hasn't been ingested yet — it is not a real service, and must
 * never be treated as one (a discovered "service" that's actually a data
 * artifact would be exactly the kind of ungrounded claim Auditability
 * forbids).
 */
const TEMPO_ROOT_SPAN_PLACEHOLDER = "<root span not yet received>";

/**
 * Distinct service names currently observed — the discovery seed list.
 * Deliberately the union of trace *roots* (from Tempo search) and every
 * node that appears anywhere in the service graph (from
 * getServiceTrafficEdges), not roots alone: a service that's only ever
 * called as a child span (e.g. `cart`, `checkout`, `payment` behind
 * `frontend-web`) would otherwise never surface at all.
 */
/**
 * The authoritative service list: Mimir's span-metrics series
 * (`traces_span_metrics_calls_total`) carries a `service_name` label for
 * every service that has ever emitted a span in the retention window,
 * regardless of how much traffic it gets. Verified empirically necessary,
 * not a guess — a real low-traffic service (`payment`, mid-incident, one
 * ten-minute-long hung trace) was confirmed to exist via Tempo's own
 * tag-filtered search, but never appeared in a 150-trace *general* Tempo
 * search sample, because general search is biased toward whatever's
 * recent and high-volume. This is the fix: don't rely on sampling to find
 * out what exists.
 */
async function listAllServiceNamesFromMetrics(): Promise<string[]> {
  const series = await querySeries("traces_span_metrics_calls_total");
  const names = new Set<string>();
  for (const labels of series) {
    if (labels.service_name) names.add(labels.service_name);
  }
  return Array.from(names);
}

export async function listActiveServiceNames(traceLimit = 150, precomputedEdges?: TrafficEdge[]): Promise<string[]> {
  const [metricNames, traces, edges] = await Promise.all([
    listAllServiceNamesFromMetrics(),
    searchTraces("", traceLimit),
    precomputedEdges ? Promise.resolve(precomputedEdges) : getServiceTrafficEdges(60, traceLimit),
  ]);
  const names = new Set<string>(metricNames);
  for (const t of traces) {
    if (t.rootServiceName && t.rootServiceName !== TEMPO_ROOT_SPAN_PLACEHOLDER) names.add(t.rootServiceName);
  }
  for (const e of edges) {
    names.add(e.source);
    names.add(e.target);
  }
  names.delete(TEMPO_ROOT_SPAN_PLACEHOLDER);
  return Array.from(names);
}
