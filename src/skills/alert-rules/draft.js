// The load-bearing reasoning step: given real computed baseline stats and a
// service's real criticality, the LLM decides what to threshold, at what
// window, and writes the rationale — grounded in the evidence it was handed,
// governed by HOUSE_RULES.md. Delete this call and there is no threshold
// decision left, only raw numbers — this is the AI-native gate applied to
// one skill.

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const HOUSE_RULES = fs.readFileSync(path.join(__dirname, "HOUSE_RULES.md"), "utf8");

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set — cannot draft rules without it.");
  return new OpenAI({ apiKey });
}

const RULE_SCHEMA_HINT = `
Respond ONLY with a JSON object of this exact shape:
{
  "rules": [
    {
      "signal_type": "trace_latency" | "trace_error_rate" | "log_error_rate",
      "operator": "gt",
      "threshold": <number>,
      "threshold_unit": "ms" | "fraction" | "lines_per_min",
      "window_minutes": <number>,
      "rationale": "<one or two sentences, must reference the actual evidence stat(s) used>",
      "evidence_stats_used": ["latency_p99_ms", "..."],
      "confidence": "high" | "medium" | "low",
      "needs_human_input": <boolean>,
      "clarifying_question": "<string — REQUIRED and must be non-null whenever needs_human_input is true; null only when needs_human_input is false>"
    }
  ]
}
If a baseline stat itself looks like it was captured during an active anomaly (e.g. p99 latency
orders of magnitude above what a normal request should take, or an error rate far above any
sane floor), do not draft a normal threshold from it — set needs_human_input: true and ask
specifically what's going on and whether to wait for a clean baseline window or use a different
reference period. Never leave clarifying_question null when needs_human_input is true.
For trace_latency, the threshold must be the p99 baseline multiplied by a margin that scales
with criticality (critical: 1.3x, high: 1.5x, medium: 1.8x, low: 2.2x) — a threshold equal to (or
barely above) the raw p99 baseline will fire on ordinary jitter and is not acceptable. State the
baseline value, the multiplier used and why, and the resulting threshold explicitly in the
rationale (e.g. "p99 baseline is 47.76ms; critical service gets a 1.3x margin -> 62ms").

Only omit a signal type entirely if its underlying baseline stat is null (no data available at
all for that signal). If a baseline stat is a real zero (e.g. error_rate_fraction: 0 or
log_error_lines_per_min: 0 — meaning no errors observed in the window, not "no data"), you MUST
still propose a rule for it: use a conservative criticality-tier floor as the threshold
(error_rate_fraction — critical: 0.01, high: 0.02, medium: 0.05, low: 0.10; log
error_lines_per_min — critical: 5, high: 10, medium: 20, low: 40), set "confidence": "low", and
the rationale must say explicitly that no error baseline was observed and this is an untuned
criticality-tier default, per house rule #1 — never silently drop a signal just because its
current value is zero.
`.trim();

const ANOMALOUS_P99_P50_RATIO = 50; // a healthy service's p99 is nowhere near 50x its own p50

/**
 * Deterministic check, not an LLM judgment call — asking the model "does
 * this baseline look like it was captured during an incident?" turned out
 * to be unreliable (same anomalous input, "true" one call and "false" the
 * next). A p99 wildly detached from the same window's own p50 is a
 * mechanical fact, not a judgment call — check it in code and skip the LLM
 * entirely for this one.
 */
function baselineLooksAnomalous(baseline) {
  const { latency_p99_ms: p99, latency_p50_ms: p50 } = baseline;
  if (p99 == null || p50 == null || p50 <= 0) return null;
  const ratio = p99 / p50;
  return ratio > ANOMALOUS_P99_P50_RATIO ? { ratio, p99, p50 } : null;
}

const MIN_EDITS_TO_LEARN = 2;
const CONSISTENCY_TOLERANCE = 0.25; // ratios must agree within 25% of each other to count as a pattern

/**
 * The self-learning contract in HOUSE_RULES.md says future drafts should
 * lean on past human corrections for the same tier — but per the same
 * lesson as tuning.js, "notice the pattern yourself" is not a job to hand
 * an LLM when it's a checkable arithmetic fact. Compute it deterministically
 * from data/outcomes.json: if humans have edited this tier+signal's drafts
 * at least twice, in a consistent direction and magnitude, return that as a
 * correction factor to apply. Otherwise return null — no invented pattern
 * from insufficient or inconsistent data.
 */
function learnedCorrectionFactor(priorOutcomes, signalType) {
  const edits = (priorOutcomes || []).filter(
    (o) => o.signal_type === signalType && o.action === "edited" && o.original_threshold > 0 && o.final_threshold > 0
  );
  if (edits.length < MIN_EDITS_TO_LEARN) return null;

  const ratios = edits.map((o) => o.final_threshold / o.original_threshold);
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const consistent = ratios.every((r) => Math.abs(r - avg) / avg <= CONSISTENCY_TOLERANCE);
  if (!consistent) return null;

  return { factor: avg, sample_size: edits.length };
}

const LEARNABLE_SIGNALS = ["trace_latency", "trace_error_rate", "log_error_rate"];

function buildPrompt(serviceProfile, baseline, priorOutcomes, factorsBySignal) {
  const anyLearned = Object.values(factorsBySignal).some(Boolean);
  const system =
    `You are the Alert Rules skill of an AI-native SRE agent. You draft alert rule thresholds ` +
    `from real observed telemetry — never from generic templates. Follow these house rules ` +
    `exactly:\n\n${HOUSE_RULES}\n\n${RULE_SCHEMA_HINT}\n\n` +
    (anyLearned
      ? `learned_correction_factor_by_signal (below) contains DETERMINISTICALLY computed correction factors ` +
        `from real prior human edits, per signal type — these are verified facts to mention in your rationale ` +
        `(e.g. "based on N prior edits for this tier, a Xx correction applies"), not something to recompute. The ` +
        `exact multiplication will be applied in code after your response, not by you — you only need to ` +
        `acknowledge it in the rationale text.`
      : `No consistent prior-edit pattern exists yet for any signal in this tier — draft from the baseline ` +
        `evidence alone.`);

  const user = JSON.stringify(
    {
      service: serviceProfile.service_name,
      criticality: serviceProfile.service_criticality,
      criticality_source: serviceProfile.criticality_source,
      baseline,
      prior_outcomes_for_this_tier: priorOutcomes || [],
      learned_correction_factor_by_signal: factorsBySignal,
    },
    null,
    2
  );

  return { system, user };
}

async function draftRulesForService(serviceProfile, baseline, priorOutcomes) {
  const anomaly = baselineLooksAnomalous(baseline);
  if (anomaly) {
    return [
      {
        id: `${serviceProfile.service_name}-baseline_anomaly-${Date.now()}`,
        service_name: serviceProfile.service_name,
        criticality: serviceProfile.service_criticality,
        status: "needs_input",
        created_at: new Date().toISOString(),
        baseline_snapshot: baseline,
        tuning_history: [],
        backtest: null,
        signal_type: "baseline_anomaly",
        needs_human_input: true,
        confidence: "low",
        clarifying_question:
          `${serviceProfile.service_name}'s current baseline p99 latency (${anomaly.p99.toFixed(1)}ms) is ` +
          `${anomaly.ratio.toFixed(0)}x its own p50 (${anomaly.p50.toFixed(1)}ms) — this window looks like it ` +
          `captured an active incident, not normal behavior. Should I wait for a clean window before drafting ` +
          `thresholds for ${serviceProfile.service_name}, or do you want to see what a fresh baseline says right now?`,
        rationale: `Skipped drafting — baseline p99/p50 ratio (${anomaly.ratio.toFixed(0)}x) exceeds the sanity threshold (${ANOMALOUS_P99_P50_RATIO}x), deterministically, before any LLM call.`,
      },
    ];
  }

  const factorsBySignal = Object.fromEntries(
    LEARNABLE_SIGNALS.map((sig) => [sig, learnedCorrectionFactor(priorOutcomes, sig)])
  );

  const { system, user } = buildPrompt(serviceProfile, baseline, priorOutcomes, factorsBySignal);
  const ai = client();

  const completion = await ai.chat.completions.create({
    model: process.env.ALERT_RULES_MODEL || "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`LLM returned invalid JSON: ${err.message}\nRaw: ${raw}`);
  }

  // Deliberately NOT trusting r.needs_human_input to gate status here — it
  // proved inconsistent (same floor-default case, sometimes flagged,
  // sometimes not; occasionally flagged alongside a correct answer it had
  // no real reason to gate on). The deterministic anomaly check above
  // already handles the one case that should skip straight to needs_input
  // before backtesting. Everything else proceeds to backtest/tune, whose
  // own gating (candidateThreshold returning null, verdict logic) has been
  // consistent under repeated testing. r.needs_human_input/clarifying_question
  // are kept as informational notes, not a status gate.
  // The factor is applied HERE, deterministically, regardless of whether the
  // LLM's own threshold already reflects it or not — same reasoning as the
  // tuning-direction guard: don't trust the model to have done the
  // arithmetic correctly just because it was told to.
  const rules = (parsed.rules || []).map((r, i) => {
    const factor = factorsBySignal[r.signal_type];
    const finalThreshold = factor && typeof r.threshold === "number" ? r.threshold * factor.factor : r.threshold;
    return {
      id: `${serviceProfile.service_name}-${r.signal_type}-${Date.now()}-${i}`,
      service_name: serviceProfile.service_name,
      criticality: serviceProfile.service_criticality,
      status: "draft",
      created_at: new Date().toISOString(),
      baseline_snapshot: baseline,
      tuning_history: [],
      backtest: null,
      ...r,
      threshold: finalThreshold,
      learned_correction_applied: factor
        ? { factor: factor.factor, sample_size: factor.sample_size, pre_correction_threshold: r.threshold }
        : null,
    };
  });

  return rules;
}

module.exports = { draftRulesForService };
