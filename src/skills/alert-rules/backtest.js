// Runs a draft rule's exact evaluation query as a range query over recent
// history, so its noise projection is known BEFORE it's ever shown for human
// approval — per the "backtest + live" decision. Same query template as the
// rule would use live (queries.js is the single source of truth for both),
// just evaluated over the past instead of continuously.

const lgtm = require("../../lgtm");
const { buildQueryForRule, traceErrorRateQuery, logErrorRateQuery } = require("../../shared/queries");
const { lokiServiceLabel } = require("../../shared/baseline");

const ACCEPTABLE_TIME_ABOVE_THRESHOLD = 0.05; // house-rule target: <5% of the backtest window
const CORROBORATION_TOLERANCE_SEC_MULT = 2; // how close a corroborating sample must be to a firing sample

// Small floors for "is there any real evidence here at all" — not thresholds
// for firing, just "not exactly zero/background noise".
const CORROBORATION_FLOOR = {
  trace_error_rate: 0.001, // >0.1% error rate
  log_error_rate: 0, // any error line at all (value > 0 after the > check below)
};

/**
 * Fetches the OTHER signal types' historical series for the same service, so
 * a firing sample can be checked against real corroborating evidence instead
 * of judged on its own signal alone. This is the house-rule #"cross-reference
 * signal types" requirement made concrete — without it, "time above
 * threshold" can't distinguish a real incident from metric jitter.
 */
async function fetchCorroborationSeries(serviceName, excludeSignalType, startSec, endSec, stepSec) {
  const series = [];

  if (excludeSignalType !== "trace_error_rate") {
    try {
      const q = traceErrorRateQuery(serviceName, Math.max(1, Math.round(stepSec / 60)) || 1);
      const r = await lgtm.queryMetricRange(q, startSec, endSec, stepSec);
      const values = (r.data?.result?.[0]?.values || []).map(([ts, v]) => ({ ts, value: Number(v) }));
      series.push({ source: "trace_error_rate", floor: CORROBORATION_FLOOR.trace_error_rate, values });
    } catch {
      // best-effort — corroboration is a cross-check, not a hard dependency
    }
  }

  if (excludeSignalType !== "log_error_rate") {
    const lokiLabel = await lokiServiceLabel(serviceName);
    if (lokiLabel) {
      try {
        const windowMinutes = Math.max(1, Math.round(stepSec / 60));
        const q = logErrorRateQuery(lokiLabel, windowMinutes);
        const r = await lgtm.queryLogsRange(q, startSec * 1000, endSec * 1000, 5000);
        const values = (r.data?.result?.[0]?.values || []).map(([ts, v]) => ({
          ts: Math.floor(Number(ts) / 1e9),
          value: Number(v),
        }));
        series.push({ source: "log_error_rate", floor: CORROBORATION_FLOOR.log_error_rate, values });
      } catch {
        // best-effort
      }
    }
  }

  return series;
}

function hasCorroboration(ts, corroborationSeries, stepSec) {
  const tolerance = stepSec * CORROBORATION_TOLERANCE_SEC_MULT;
  for (const { floor, values } of corroborationSeries) {
    const nearby = values.find((v) => Math.abs(v.ts - ts) <= tolerance);
    if (nearby && nearby.value > floor) return true;
  }
  return false;
}

function groupIntoEpisodes(timestamps, stepSec) {
  if (!timestamps.length) return [];
  const episodes = [];
  let start = timestamps[0];
  let prev = timestamps[0];
  for (let i = 1; i < timestamps.length; i++) {
    const t = timestamps[i];
    if (t - prev > stepSec * 2) {
      episodes.push({ start, end: prev });
      start = t;
    }
    prev = t;
  }
  episodes.push({ start, end: prev });
  return episodes;
}

async function backtestRule(rule, hoursBack = 24) {
  const windowMinutes = rule.window_minutes || 15;
  const stepSec = Math.max(60, windowMinutes * 30); // reasonable resolution vs. query cost

  let lokiLabel = null;
  if (rule.signal_type === "log_error_rate") {
    lokiLabel = await lokiServiceLabel(rule.service_name);
  }

  const built = buildQueryForRule(rule.signal_type, rule.service_name, lokiLabel, windowMinutes);
  if (!built) {
    return {
      run_at: new Date().toISOString(),
      hours_back: hoursBack,
      verdict: "untestable",
      reason: `No queryable data source for signal_type "${rule.signal_type}" on ${rule.service_name}.`,
    };
  }

  const endSec = Math.floor(Date.now() / 1000);
  const startSec = endSec - hoursBack * 3600;

  let samples = [];
  try {
    if (built.kind === "metric") {
      const result = await lgtm.queryMetricRange(built.query, startSec, endSec, stepSec);
      const series = result.data?.result?.[0]?.values || [];
      samples = series.map(([ts, v]) => ({ ts, value: Number(v) / built.divideBy }));
    } else {
      const result = await lgtm.queryLogsRange(built.query, startSec * 1000, endSec * 1000, 5000);
      const series = result.data?.result?.[0]?.values || [];
      samples = series.map(([ts, v]) => ({ ts: Math.floor(Number(ts) / 1e9), value: Number(v) / built.divideBy }));
    }
  } catch (err) {
    return {
      run_at: new Date().toISOString(),
      hours_back: hoursBack,
      query: built.query,
      verdict: "query_failed",
      error: err.message,
    };
  }

  if (!samples.length) {
    return {
      run_at: new Date().toISOString(),
      hours_back: hoursBack,
      query: built.query,
      verdict: "no_historical_data",
      total_samples: 0,
    };
  }

  const operator = rule.operator || "gt";
  const above = samples.filter((s) => (operator === "gt" ? s.value > rule.threshold : s.value < rule.threshold));
  const fractionAbove = above.length / samples.length;
  const episodes = groupIntoEpisodes(above.map((s) => s.ts), stepSec);

  let verdict;
  let corroboratedFraction = null;

  if (fractionAbove === 0) {
    verdict = "never_fired_in_window";
  } else if (fractionAbove <= ACCEPTABLE_TIME_ABOVE_THRESHOLD) {
    verdict = "acceptable";
  } else {
    // Fires more than the ceiling — before calling this "noisy", check
    // whether the other signal types actually corroborate it. A latency
    // spike with matching error-rate/log-error evidence is a real incident
    // the rule correctly caught, not a false alarm to tune away.
    const corroboration = await fetchCorroborationSeries(rule.service_name, rule.signal_type, startSec, endSec, stepSec);
    const corroboratedCount = above.filter((s) => hasCorroboration(s.ts, corroboration, stepSec)).length;
    corroboratedFraction = above.length ? corroboratedCount / above.length : 0;
    verdict = corroboratedFraction >= 0.5 ? "frequent_but_corroborated" : "likely_noisy";
  }

  return {
    run_at: new Date().toISOString(),
    hours_back: hoursBack,
    query: built.query,
    total_samples: samples.length,
    samples_above_threshold: above.length,
    fraction_time_above_threshold: fractionAbove,
    projected_firing_episodes: episodes.length,
    acceptable_ceiling: ACCEPTABLE_TIME_ABOVE_THRESHOLD,
    corroborated_fraction: corroboratedFraction,
    verdict,
    // Raw values, not just the above/below split — so a tuning step can
    // compute a directionally-correct candidate threshold deterministically
    // instead of asking an LLM to invent one from scratch (see tuning.js).
    samples: samples.map((s) => ({ ts: s.ts, value: s.value })),
  };
}

module.exports = { backtestRule };
