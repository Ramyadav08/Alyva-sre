/**
 * Baselining, ported from baseline.js: a fixed 15-minute lookback,
 * point-in-time instant queries — no rolling/multi-window statistics, no
 * stddev. "Normal" isn't derived here; draft.ts and tuning.ts do that.
 * Every stat carries the exact query it came from, so a drafted rule's
 * rationale can cite it directly (Auditability).
 */
import {
  queryMetricInstant,
  queryLokiMetricInstant,
  resolveLokiServiceLabel,
} from "../lgtm";
import { buildQueryForRule } from "./queries";

const WINDOW_MINUTES = 15;

export type Stat = { value: number | null; promql: string; error?: string };

export type ServiceBaseline = {
  serviceName: string;
  windowMinutes: number;
  computedAt: string;
  latencyP99Ms: Stat;
  latencyP50Ms: Stat;
  callRatePerSec: Stat;
  errorRateFraction: Stat;
  logErrorLinesPerMin: Stat | null; // null when no Loki stream resolves for this service
};

async function metricStat(promql: string): Promise<Stat> {
  try {
    const value = await queryMetricInstant(promql);
    return { value, promql };
  } catch (err) {
    return { value: null, promql, error: (err as Error).message };
  }
}

export async function computeBaseline(serviceName: string): Promise<ServiceBaseline> {
  const svc = serviceName.replace(/"/g, '\\"');
  const w = `${WINDOW_MINUTES}m`;

  const p99Query = buildQueryForRule("trace_latency", serviceName, WINDOW_MINUTES)!.query;
  const p50Query = `histogram_quantile(0.50, sum by(le)(rate(traces_span_metrics_duration_milliseconds_bucket{service_name="${svc}"}[${w}])))`;
  const callRateQuery = `sum(rate(traces_span_metrics_calls_total{service_name="${svc}"}[${w}]))`;
  const errorRateQuery = buildQueryForRule("trace_error_rate", serviceName, WINDOW_MINUTES)!.query;

  const [latencyP99Ms, latencyP50Ms, callRatePerSec, errorRateFraction] = await Promise.all([
    metricStat(p99Query),
    metricStat(p50Query),
    metricStat(callRateQuery),
    metricStat(errorRateQuery),
  ]);

  let logErrorLinesPerMin: Stat | null = null;
  const lokiLabel = await resolveLokiServiceLabel(serviceName);
  if (lokiLabel) {
    const logQuery = buildQueryForRule("log_error_rate", lokiLabel, WINDOW_MINUTES)!.query;
    try {
      const raw = await queryLokiMetricInstant(logQuery);
      logErrorLinesPerMin = { value: raw !== null ? raw / WINDOW_MINUTES : null, promql: logQuery };
    } catch (err) {
      logErrorLinesPerMin = { value: null, promql: logQuery, error: (err as Error).message };
    }
  }

  return {
    serviceName,
    windowMinutes: WINDOW_MINUTES,
    computedAt: new Date().toISOString(),
    latencyP99Ms,
    latencyP50Ms,
    callRatePerSec,
    errorRateFraction,
    logErrorLinesPerMin,
  };
}
