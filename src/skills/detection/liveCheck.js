// Real live-firing check against APPROVED Alert Rules — this is the actual
// trigger source (per the "only approved rules firing live" decision), not
// an independent watcher duplicating Alert Rules' own anomaly detection.
// Deliberately a short, recent window (not the rule's full backtest window)
// — this answers "is it breaching RIGHT NOW", not "did it breach recently".

const lgtm = require("../../lgtm");
const { buildQueryForRule } = require("../../shared/queries");
const { lokiServiceLabel } = require("../../shared/baseline");

const LIVE_CHECK_WINDOW_MINUTES = 5;

async function checkLiveFiring(rule) {
  let lokiLabel = null;
  if (rule.signal_type === "log_error_rate") {
    lokiLabel = await lokiServiceLabel(rule.service_name);
  }
  const built = buildQueryForRule(rule.signal_type, rule.service_name, lokiLabel, LIVE_CHECK_WINDOW_MINUTES);
  if (!built) return { firing: false, reason: "no_queryable_source" };

  let value = null;
  try {
    if (built.kind === "metric") {
      const result = await lgtm.queryMetric(built.query);
      value = Number(result.data?.result?.[0]?.value?.[1]);
    } else {
      const result = await lgtm.queryLogs(built.query, LIVE_CHECK_WINDOW_MINUTES, 1);
      const series = result.data?.result?.[0]?.values || [];
      const last = series.length ? Number(series[series.length - 1][1]) : 0;
      value = last / built.divideBy;
    }
  } catch (err) {
    return { firing: false, reason: "query_failed", error: err.message };
  }

  if (!Number.isFinite(value)) return { firing: false, reason: "no_data" };

  const operator = rule.operator || "gt";
  const firing = operator === "gt" ? value > rule.threshold : value < rule.threshold;
  return { firing, live_value: value, threshold: rule.threshold, query: built.query, checked_at: new Date().toISOString() };
}

module.exports = { checkLiveFiring, LIVE_CHECK_WINDOW_MINUTES };
