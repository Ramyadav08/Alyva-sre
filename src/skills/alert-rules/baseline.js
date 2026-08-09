// Computes real baseline statistics per service, per signal type — metrics,
// logs, and traces, per the "must be based on traces, logs and metrics"
// requirement. Every stat carries the exact query used to produce it, so the
// draft step (and later, the review UI) can cite real evidence, not just a
// number that appeared from nowhere.

const lgtm = require("../../lgtm");
const { traceLatencyP99Query, traceErrorRateQuery, logErrorRateQuery } = require("./queries");

const WINDOW = "15m";
const WINDOW_MINUTES = 15;

function num(vectorResult) {
  const v = vectorResult?.data?.result?.[0]?.value?.[1];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function metricStat(promql) {
  try {
    const result = await lgtm.queryMetric(promql);
    return { value: num(result), promql, raw_status: result.status };
  } catch (err) {
    return { value: null, promql, error: err.message };
  }
}

/** Maps our service_name to the Loki job/service_name label, if any logs exist for it. */
async function lokiServiceLabel(serviceName) {
  try {
    const values = await lgtm.listLokiLabelValues("service_name");
    const candidate = `opentelemetry-demo/${serviceName}`;
    return values.data?.includes(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function computeBaseline(serviceName) {
  const evidence = [];

  const latencyP99 = await metricStat(traceLatencyP99Query(serviceName, WINDOW_MINUTES));
  const latencyP50 = await metricStat(
    `histogram_quantile(0.50, sum by(le)(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${serviceName}"}[${WINDOW}])))`
  );
  const callRate = await metricStat(
    `sum(rate(traces_span_metrics_calls_total{service_name="${serviceName}"}[${WINDOW}]))`
  );
  const errorRate = await metricStat(traceErrorRateQuery(serviceName, WINDOW_MINUTES));

  evidence.push(
    { signal: "trace", stat: "latency_p99_ms", ...latencyP99 },
    { signal: "trace", stat: "latency_p50_ms", ...latencyP50 },
    { signal: "trace", stat: "call_rate_per_sec", ...callRate },
    { signal: "trace", stat: "error_rate_fraction", ...errorRate }
  );

  let logErrorRate = { value: null, logql: null, note: "no log stream found for this service" };
  const lokiLabel = await lokiServiceLabel(serviceName);
  if (lokiLabel) {
    const logql = logErrorRateQuery(lokiLabel, WINDOW_MINUTES);
    try {
      const r = await lgtm.queryLogs(logql, WINDOW_MINUTES, 1);
      const series = r.data?.result?.[0]?.values || [];
      const last = series.length ? Number(series[series.length - 1][1]) : 0;
      logErrorRate = { value: last / WINDOW_MINUTES, logql, unit: "error_lines_per_min" };
    } catch (err) {
      logErrorRate = { value: null, logql, error: err.message };
    }
  }
  evidence.push({ signal: "log", stat: "error_lines_per_min", ...logErrorRate });

  return {
    service_name: serviceName,
    computed_at: new Date().toISOString(),
    window: WINDOW,
    latency_p99_ms: latencyP99.value,
    latency_p50_ms: latencyP50.value,
    call_rate_per_sec: callRate.value,
    error_rate_fraction: errorRate.value,
    log_error_lines_per_min: logErrorRate.value,
    evidence,
  };
}

module.exports = { computeBaseline, lokiServiceLabel };
