// Raw observability primitives — real metrics/traces/logs, no derived
// business logic. This environment is Docker Compose (container_runtime:
// "docker" on every container series), NOT Kubernetes — there's no pod
// concept and no restart-count metric. "Top N pods" maps to the real
// equivalent here: container_name. "Recently failed" maps to real signals
// that actually exist (up==0 scrape gaps, elevated error rate) — never a
// fabricated pod-status field.

const lgtm = require("../lgtm");

async function topContainersByCpu(limit = 10) {
  const result = await lgtm.queryMetric(`topk(${limit}, avg by(container_name)(container_cpu_utilization_ratio))`);
  return (result.data?.result || []).map((r) => ({ container_name: r.metric.container_name, cpu_utilization_ratio: Number(r.value[1]) }));
}

async function topContainersByMemory(limit = 10) {
  const result = await lgtm.queryMetric(`topk(${limit}, avg by(container_name)(container_memory_percent_ratio))`);
  return (result.data?.result || []).map((r) => ({ container_name: r.metric.container_name, memory_percent: Number(r.value[1]) }));
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
        const r = await lgtm.queryMetric(
          `sum(rate(traces_span_metrics_calls_total{service_name="${svc.service_name}",status_code="STATUS_CODE_ERROR"}[5m])) / clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="${svc.service_name}"}[5m])), 0.001)`
        );
        const value = Number(r.data?.result?.[0]?.value?.[1]);
        return Number.isFinite(value) && value > 0.05 ? { service_name: svc.service_name, error_rate: value, reason: "error rate > 5% in the last 5m" } : null;
      } catch {
        return null;
      }
    })
  );

  return { down_scrape_targets: down, elevated_error_rate: errorChecks.filter(Boolean) };
}

async function recentTracesAcrossServices(limit = 10) {
  const discovered = await lgtm.discoverServices();
  const sample = discovered.slice(0, 8); // cap — searching every service would be slow for a chat response
  const results = [];
  for (const svc of sample) {
    try {
      const r = await lgtm.searchTraces(`service.name=${svc.service_name}`, 2);
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

async function recentErrorLogs(limit = 10) {
  const result = await lgtm.queryLogs('{level="ERROR"}', 15, limit);
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

module.exports = { topContainersByCpu, topContainersByMemory, recentlyUnhealthy, recentTracesAcrossServices, recentErrorLogs };
