/**
 * Backtesting, ported from backtest.js: replay a drafted (or active)
 * rule's exact query against real historical LGTM data before ever
 * showing it to a human, or before proposing a retune. Nothing here is
 * simulated — every sample is a real query result over a real time
 * window.
 */
import { queryMetricsRange, queryLokiMetricRange, resolveLokiServiceLabel } from "../lgtm";
import { buildQueryForRule } from "./queries";
import type { AlertBacktestResult, AlertBacktestVerdict, AlertSignalType } from "../models";

const ACCEPTABLE_TIME_ABOVE_THRESHOLD = 0.05; // 5% ceiling, ported from backtest.js
const CORROBORATION_TOLERANCE_SEC_MULT = 2;
const CORROBORATION_FLOOR: Record<string, number> = {
  trace_error_rate: 0.001,
  log_error_rate: 0, // any observed log error line at all counts
};

type Sample = { tsSec: number; value: number };

async function fetchSeries(
  signalType: AlertSignalType,
  serviceName: string,
  windowMinutes: number,
  startSec: number,
  endSec: number,
  stepSec: number,
): Promise<Sample[]> {
  const built = buildQueryForRule(signalType, serviceName, windowMinutes);
  if (!built) return [];

  if (built.kind === "metric") {
    const result = await queryMetricsRange(built.query, startSec, endSec, `${stepSec}s`);
    const series = result[0]?.values ?? [];
    return series.map(([ts, v]) => ({ tsSec: ts, value: Number(v) }));
  }

  // log kind: resolve the Loki label for THIS service, not the rule's
  // original serviceName param (buildQueryForRule for log_error_rate
  // expects a pre-resolved Loki label as its "serviceName" argument).
  const lokiLabel = await resolveLokiServiceLabel(serviceName);
  if (!lokiLabel) return [];
  const logBuilt = buildQueryForRule(signalType, lokiLabel, windowMinutes)!;
  const raw = await queryLokiMetricRange(logBuilt.query, startSec * 1e9, endSec * 1e9, `${stepSec}s`);
  const divideBy = logBuilt.divideBy ?? 1;
  return raw.map(([ts, v]) => ({ tsSec: ts, value: Number(v) / divideBy }));
}

function groupIntoEpisodes(timestampsSec: number[], gapThresholdSec: number): number {
  if (timestampsSec.length === 0) return 0;
  const sorted = [...timestampsSec].sort((a, b) => a - b);
  let episodes = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gapThresholdSec) episodes++;
  }
  return episodes;
}

export async function backtestRule(
  rule: { serviceId: string; signalType: AlertSignalType; operator: "gt" | "lt"; threshold: number; windowMinutes: number },
  hoursBack = 24,
): Promise<AlertBacktestResult> {
  const now = new Date();
  const endSec = Math.floor(now.getTime() / 1000);
  const startSec = endSec - hoursBack * 3600;
  const stepSec = Math.max(60, rule.windowMinutes * 30);
  const ranAt = now.toISOString();

  const built = buildQueryForRule(rule.signalType, rule.serviceId, rule.windowMinutes);
  if (!built) {
    return { verdict: "untestable", fractionAbove: null, sampleCount: 0, episodeCount: 0, corroboratedFraction: null, ranAt };
  }

  let samples: Sample[];
  try {
    samples = await fetchSeries(rule.signalType, rule.serviceId, rule.windowMinutes, startSec, endSec, stepSec);
  } catch {
    return { verdict: "query_failed", fractionAbove: null, sampleCount: 0, episodeCount: 0, corroboratedFraction: null, ranAt };
  }

  if (samples.length === 0) {
    return { verdict: "no_historical_data", fractionAbove: null, sampleCount: 0, episodeCount: 0, corroboratedFraction: null, ranAt };
  }

  const above = samples.filter((s) => (rule.operator === "gt" ? s.value > rule.threshold : s.value < rule.threshold));
  const fractionAbove = above.length / samples.length;
  const episodeCount = groupIntoEpisodes(above.map((s) => s.tsSec), stepSec * 2);

  if (fractionAbove === 0) {
    return { verdict: "never_fired_in_window", fractionAbove, sampleCount: samples.length, episodeCount, corroboratedFraction: null, ranAt, rawValues: samples.map((s) => s.value) };
  }
  if (fractionAbove <= ACCEPTABLE_TIME_ABOVE_THRESHOLD) {
    return { verdict: "acceptable", fractionAbove, sampleCount: samples.length, episodeCount, corroboratedFraction: null, ranAt, rawValues: samples.map((s) => s.value) };
  }

  // Above the ceiling — check whether firing correlates with a real,
  // independent signal before calling it noise. A latency rule firing
  // exactly when errors/log-errors also spike is a real incident, not
  // noise, regardless of how often it fires.
  const otherSignals: AlertSignalType[] = (["trace_error_rate", "log_error_rate"] as AlertSignalType[]).filter(
    (s) => s !== rule.signalType,
  );
  let corroboratedCount = 0;
  for (const signal of otherSignals) {
    const floor = CORROBORATION_FLOOR[signal] ?? 0;
    let corroborating: Sample[];
    try {
      corroborating = await fetchSeries(signal, rule.serviceId, rule.windowMinutes, startSec, endSec, stepSec);
    } catch {
      continue;
    }
    for (const a of above) {
      const nearby = corroborating.find((c) => Math.abs(c.tsSec - a.tsSec) <= stepSec * CORROBORATION_TOLERANCE_SEC_MULT);
      if (nearby && nearby.value > floor) corroboratedCount++;
    }
  }
  const corroboratedFraction = Math.min(1, corroboratedCount / above.length);

  const verdict: AlertBacktestVerdict = corroboratedFraction >= 0.5 ? "frequent_but_corroborated" : "likely_noisy";
  return { verdict, fractionAbove, sampleCount: samples.length, episodeCount, corroboratedFraction, ranAt, rawValues: samples.map((s) => s.value) };
}
