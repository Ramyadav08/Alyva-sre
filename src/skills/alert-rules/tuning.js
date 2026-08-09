// Self-tuning loop. Two distinct uses, both governed by HOUSE_RULES.md:
//
// 1. refineDraftViaBacktest — BEFORE a rule is ever shown to a human, iterate
//    against historical backtest data until noise is acceptable or the agent
//    gives up and asks a question. Nothing here is "live" yet, so iterating
//    silently is fine — it's the agent doing its own homework before
//    proposing.
// 2. proposeRetune — AFTER a rule is approved and active, evaluate fresh
//    backtest data and produce exactly ONE new proposal if it's drifted
//    noisy. This is never auto-applied — it's logged and surfaced for human
//    approval like any other proposal (house rule #4).
//
// Both ways, adjustments are cited (before/after + the evidence that
// triggered them) — never a mute, per house rule #3.

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { backtestRule } = require("./backtest");

const HOUSE_RULES = fs.readFileSync(path.join(__dirname, "HOUSE_RULES.md"), "utf8");

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set — cannot tune rules without it.");
  return new OpenAI({ apiKey });
}

const OUTLIER_MULTIPLE = 5; // a sample beyond 5x the median is treated as a real incident, not baseline
const MAX_EXCLUDED_FRACTION = 0.5; // if calibrating would need to drop >50% of samples, refuse to calibrate

/**
 * A real SRE doesn't set the fire-alarm threshold using data from during the
 * fire. Before computing a percentile-based candidate, exclude samples that
 * look like a genuine incident (far beyond the window's own median) — those
 * stay fully visible to the deployed rule, they just don't get averaged into
 * deciding where the "normal" bar sits. If too much of the window would need
 * to be excluded (no real quiet baseline to calibrate against), refuse to
 * produce a candidate at all rather than guess.
 */
function excludeIncidentPeriods(values, operator) {
  if (values.length < 3) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return values;
  const clean =
    operator === "gt"
      ? values.filter((v) => v <= median * OUTLIER_MULTIPLE)
      : values.filter((v) => v >= median / OUTLIER_MULTIPLE);
  const excludedFraction = 1 - clean.length / values.length;
  return excludedFraction > MAX_EXCLUDED_FRACTION ? null : clean;
}

/**
 * Deterministic, directionally-guaranteed candidate: the value at the
 * (1 - target ceiling) percentile of the historical samples, AFTER excluding
 * incident-like outliers (see excludeIncidentPeriods above) — for a "gt"
 * rule (symmetric for "lt"). This exists because letting an LLM invent a raw
 * replacement number from scratch turned out to be unreliable — it
 * repeatedly moved the threshold in the WRONG direction for a "gt" operator
 * (lowering it to "reduce noise", which actually increases firing). Handing
 * the LLM a correct-by-construction anchor and asking it to judge/adjust
 * from there, rather than invent ex nihilo, avoids that failure mode.
 *
 * Returns null if there's no safe baseline to calibrate against — callers
 * must treat that as "ask a human", never as "guess anyway".
 */
function candidateThreshold(rule, backtestResult) {
  const rawValues = (backtestResult.samples || []).map((s) => s.value).filter((v) => Number.isFinite(v));
  if (!rawValues.length) return null;
  const operator = rule.operator || "gt";
  const values = excludeIncidentPeriods(rawValues, operator);
  if (values == null || !values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const ceiling = backtestResult.acceptable_ceiling ?? 0.05;
  if (operator === "gt") {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((1 - ceiling) * sorted.length) - 1));
    return sorted[idx];
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(ceiling * sorted.length)));
  return sorted[idx];
}

async function proposeAdjustment(rule, backtestResult) {
  const candidate = candidateThreshold(rule, backtestResult);

  // No safe baseline to calibrate against (too much of the window looks like
  // a real incident) — ask a human rather than have the LLM guess a number
  // with nothing solid to anchor it.
  if (candidate == null) {
    return {
      give_up: true,
      new_threshold: null,
      new_window_minutes: null,
      rationale: `Backtest window has no clean baseline period to calibrate against — more than ${Math.round(MAX_EXCLUDED_FRACTION * 100)}% of samples look incident-like relative to the window's own median.`,
      question_if_give_up:
        `The backtest window for ${rule.service_name}'s ${rule.signal_type} rule doesn't have enough ` +
        `"normal" data to safely calibrate a threshold from — most of the window looks like it was ` +
        `already degraded. Can you confirm a time range that reflects normal operation, or accept the ` +
        `current threshold as-is until more baseline data accumulates?`,
    };
  }

  const ai = client();
  const system =
    `You are the Alert Rules skill's tuning step. A drafted rule backtested noisy against real ` +
    `historical data. You are given a statistically-derived CANDIDATE threshold, computed ` +
    `deterministically from the actual historical samples so its DIRECTION is guaranteed correct ` +
    `— it already moves the threshold the right way to bring firing frequency down to the target ` +
    `ceiling for this operator. Your job is judgment, not arithmetic: use the candidate as-is, or ` +
    `adjust it (tighter for critical services, looser for low-tolerance ones) based on criticality ` +
    `— but never move it in the OPPOSITE direction from the candidate relative to the current ` +
    `threshold, that would be a directional error. Give up and ask a question instead if you ` +
    `genuinely can't tell what's wrong. Follow these house rules exactly:\n\n${HOUSE_RULES}\n\n` +
    `Respond ONLY with JSON: {"give_up": boolean, "new_threshold": number|null, ` +
    `"new_window_minutes": number|null, "rationale": "<cites the backtest numbers AND the ` +
    `candidate, explains any deviation from it>", "question_if_give_up": string|null}. Never ` +
    `propose muting/disabling — only a threshold or window change, or a question.`;
  const user = JSON.stringify(
    {
      rule: { service_name: rule.service_name, signal_type: rule.signal_type, criticality: rule.criticality, operator: rule.operator, threshold: rule.threshold, threshold_unit: rule.threshold_unit, window_minutes: rule.window_minutes },
      backtest: { ...backtestResult, samples: undefined }, // raw samples already distilled into `candidate`
      deterministic_candidate_threshold: candidate,
    },
    null,
    2
  );

  const completion = await ai.chat.completions.create({
    model: process.env.ALERT_RULES_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");

  // Structural guard, not just a prompt instruction: if the LLM proposed a
  // threshold that moves in the opposite direction from the deterministic
  // candidate relative to the current threshold, it's a directional error
  // (this happened repeatedly before candidateThreshold() existed) — clamp
  // to the candidate rather than trust it.
  if (!parsed.give_up && candidate != null && parsed.new_threshold != null) {
    const operator = rule.operator || "gt";
    const candidateDir = Math.sign(candidate - rule.threshold);
    const proposedDir = Math.sign(parsed.new_threshold - rule.threshold);
    const directionIsWrong = candidateDir !== 0 && proposedDir !== 0 && candidateDir !== proposedDir;
    if (directionIsWrong) {
      parsed.new_threshold = candidate;
      parsed.rationale = `${parsed.rationale} [guard: proposed value moved the wrong direction for a "${operator}" rule — clamped to the deterministic candidate ${candidate}.]`;
    }
  }

  return parsed;
}

async function refineDraftViaBacktest(rule, { maxIterations = 4, hoursBack = 24 } = {}) {
  let current = { ...rule };
  const tuningLog = current.tuning_history ? [...current.tuning_history] : [];

  for (let i = 0; i < maxIterations; i++) {
    const bt = await backtestRule(current, hoursBack);

    if (["untestable", "no_historical_data", "query_failed"].includes(bt.verdict)) {
      return { rule: { ...current, backtest: bt, tuning_history: tuningLog }, status: "draft" };
    }
    if (bt.verdict === "acceptable" || bt.verdict === "never_fired_in_window") {
      return { rule: { ...current, backtest: bt, tuning_history: tuningLog }, status: "draft_ready" };
    }
    if (bt.verdict === "frequent_but_corroborated") {
      // Fires often, but real error-rate/log evidence backs it every time —
      // this is the rule correctly catching real incidents, not noise. Per
      // house rule #3, never tune this away automatically; ask a human
      // whether the firing frequency itself is acceptable given how often
      // real incidents are actually happening.
      return {
        rule: { ...current, backtest: bt, tuning_history: tuningLog, status: "needs_input" },
        status: "needs_input",
        question:
          `This rule fired in ${Math.round(bt.fraction_time_above_threshold * 100)}% of the backtest window, ` +
          `and ${Math.round(bt.corroborated_fraction * 100)}% of those firings are corroborated by real ` +
          `error-rate/log evidence at the same time — this looks like real incidents, not noise. Is that firing ` +
          `frequency acceptable for ${current.service_name}, or has something been genuinely broken this whole window?`,
      };
    }

    // likely_noisy — ask the LLM for a cited adjustment.
    const proposal = await proposeAdjustment(current, bt);
    if (proposal.give_up || proposal.new_threshold == null) {
      return {
        rule: { ...current, backtest: bt, tuning_history: tuningLog, status: "needs_input" },
        status: "needs_input",
        question: proposal.question_if_give_up || "Could not converge to an acceptable threshold — needs human input.",
      };
    }

    tuningLog.push({
      iteration: i + 1,
      at: new Date().toISOString(),
      before_threshold: current.threshold,
      after_threshold: proposal.new_threshold,
      before_window_minutes: current.window_minutes,
      after_window_minutes: proposal.new_window_minutes || current.window_minutes,
      reason: proposal.rationale,
      backtest_before: { verdict: bt.verdict, fraction_time_above_threshold: bt.fraction_time_above_threshold },
    });

    current = {
      ...current,
      threshold: proposal.new_threshold,
      window_minutes: proposal.new_window_minutes || current.window_minutes,
    };
  }

  const finalBacktest = await backtestRule(current, hoursBack);
  return {
    rule: { ...current, backtest: finalBacktest, tuning_history: tuningLog },
    status: finalBacktest.verdict === "acceptable" ? "draft_ready" : "needs_input",
    question:
      finalBacktest.verdict === "acceptable"
        ? undefined
        : `Ran ${maxIterations} tuning iterations and still projects noisy (${Math.round((finalBacktest.fraction_time_above_threshold || 0) * 100)}% of backtest window) — needs human judgment on acceptable tolerance for this service.`,
  };
}

/** Post-approval: one single cited proposal, never auto-applied. */
async function proposeRetune(activeRule, hoursBack = 24) {
  const bt = await backtestRule(activeRule, hoursBack);
  if (bt.verdict !== "likely_noisy") return { needs_retune: false, backtest: bt };
  const proposal = await proposeAdjustment(activeRule, bt);
  return { needs_retune: true, backtest: bt, proposal };
}

module.exports = { refineDraftViaBacktest, proposeRetune, proposeAdjustment };
