/**
 * Query templates ported from Ramya's src/skills/alert-rules/queries.js,
 * verbatim in substance — same three signal types, same query shapes.
 * Kept as a single dispatcher so "what backtest.ts replays" and "what the
 * live rule would evaluate" are provably the same query, just over a
 * different time range.
 */
import type { AlertSignalType } from "../models";

export type RuleQuery = { kind: "metric" | "log"; query: string; divideBy?: number };

export function buildQueryForRule(
  signalType: AlertSignalType,
  serviceName: string,
  windowMinutes: number,
): RuleQuery | null {
  const svc = serviceName.replace(/"/g, '\\"');
  const w = `${windowMinutes}m`;

  switch (signalType) {
    case "trace_latency":
      return {
        kind: "metric",
        query: `histogram_quantile(0.99, sum by(le)(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${svc}"}[${w}])))`,
      };
    case "trace_error_rate":
      return {
        kind: "metric",
        query:
          `sum(rate(traces_span_metrics_calls_total{service_name="${svc}",status_code="STATUS_CODE_ERROR"}[${w}])) / ` +
          `clamp_min(sum(rate(traces_span_metrics_calls_total{service_name="${svc}"}[${w}])), 0.001)`,
      };
    case "log_error_rate":
      // Loki label conventions on this stack use service_name too (verified
      // via the same label set metrics use) — callers must resolve whether
      // a Loki stream actually exists for this service before relying on
      // this; see baseline.ts.
      return {
        kind: "log",
        query: `sum(count_over_time({service_name="${svc}", level="ERROR"}[${w}]))`,
        divideBy: windowMinutes,
      };
    default:
      return null;
  }
}
