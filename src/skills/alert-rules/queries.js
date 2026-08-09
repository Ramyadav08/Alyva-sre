// Single source of truth for the query template per signal type, parameterized
// by window. baseline.js uses these at a fixed 15m window to compute current
// stats; backtest.js re-runs the exact same template as a range query over
// historical data using the rule's own window — so what gets backtested is
// provably the same query that would actually evaluate the rule live.

function traceLatencyP99Query(serviceName, windowMinutes) {
  return `histogram_quantile(0.99, sum by(le)(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${serviceName}"}[${windowMinutes}m])))`;
}

function traceErrorRateQuery(serviceName, windowMinutes) {
  return (
    `sum(rate(traces_span_metrics_calls_total{service_name="${serviceName}",status_code="STATUS_CODE_ERROR"}[${windowMinutes}m])) / ` +
    `clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="${serviceName}"}[${windowMinutes}m])), 0.001)`
  );
}

function logErrorRateQuery(lokiServiceLabel, windowMinutes) {
  // count_over_time returns a raw count for the window; callers divide by
  // windowMinutes themselves to get a lines_per_min rate.
  return `sum(count_over_time({service_name="${lokiServiceLabel}", level="ERROR"}[${windowMinutes}m]))`;
}

/** Returns { kind: 'metric' | 'log', query, divideBy } for a given rule's signal_type. */
function buildQueryForRule(signalType, serviceName, lokiServiceLabel, windowMinutes) {
  switch (signalType) {
    case "trace_latency":
      return { kind: "metric", query: traceLatencyP99Query(serviceName, windowMinutes), divideBy: 1 };
    case "trace_error_rate":
      return { kind: "metric", query: traceErrorRateQuery(serviceName, windowMinutes), divideBy: 1 };
    case "log_error_rate":
      if (!lokiServiceLabel) return null;
      return {
        kind: "log",
        query: logErrorRateQuery(lokiServiceLabel, windowMinutes),
        divideBy: windowMinutes,
      };
    default:
      return null;
  }
}

module.exports = { traceLatencyP99Query, traceErrorRateQuery, logErrorRateQuery, buildQueryForRule };
