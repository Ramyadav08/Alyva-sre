/**
 * Threshold drafting, ported from draft.js — the load-bearing reasoning
 * step for this skill: delete this call and there is no threshold
 * decision left, only a fixed baseline multiplier a human would have had
 * to pick themselves.
 */
import { getDb } from "../store";
import { getLLMClient, type ToolDefinition } from "../llm";
import { loadSkillDoc } from "../skills";
import { listActivePolicies } from "../alert-policies";
import type { ServiceBaseline } from "./baseline";
import type { AlertCriticality, AlertRulePayload, AlertSignalType } from "../models";

const ANOMALOUS_P99_P50_RATIO = 50;
const MIN_EDITS_TO_LEARN = 2;
const CONSISTENCY_TOLERANCE = 0.25;

/** Prefix marking a baseline_anomaly clarifying question, so run.ts can find a prior answer for this exact gate without a separate Question "topic" field. */
export const BASELINE_ANOMALY_MARKER = "[baseline_anomaly] ";

export type DraftedRule =
  | (AlertRulePayload & { threshold: number; windowMinutes: number; needsHumanInput: false })
  | {
      serviceId: string;
      signalType: AlertSignalType | "baseline_anomaly";
      needsHumanInput: true;
      clarifyingQuestion: string;
      rationale: string;
    };

/** Deterministic pre-check, no LLM: an outlier p99 relative to p50 usually means the baseline window itself caught an incident, not "normal." */
function baselineLooksAnomalous(baseline: ServiceBaseline): boolean {
  const p99 = baseline.latencyP99Ms.value;
  const p50 = baseline.latencyP50Ms.value;
  if (p99 === null || p50 === null || p50 <= 0) return false;
  return p99 / p50 > ANOMALOUS_P99_P50_RATIO;
}

/**
 * Scans this codebase's own Proposal history for kind='alert_rule'
 * proposals a human edited before approving, and — if a consistent
 * correction factor emerges for this signal type — surfaces it as
 * informational context for the LLM. This is the "self-learning
 * contract": past human corrections shape future drafts, without ever
 * silently overriding what the LLM itself decides.
 */
async function learnedCorrectionFactor(signalType: AlertSignalType): Promise<{ factor: number; sampleSize: number } | null> {
  const db = await getDb();
  const ratios: number[] = [];
  for (const p of db.data.proposals) {
    if (p.kind !== "alert_rule") continue;
    const payload = p.payload as AlertRulePayload;
    if (payload.signalType !== signalType || payload.retuneOfRuleId) continue;
    const pendingEntry = p.history.find((h) => h.status === "pending");
    const editedEntry = [...p.history].reverse().find((h) => h.status === "edited");
    if (!pendingEntry || !editedEntry) continue;
    const original = (pendingEntry.payload as AlertRulePayload)?.threshold;
    const final = (editedEntry.payload as AlertRulePayload)?.threshold;
    if (typeof original === "number" && typeof final === "number" && original !== 0) {
      ratios.push(final / original);
    }
  }
  if (ratios.length < MIN_EDITS_TO_LEARN) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const consistent = ratios.every((r) => Math.abs(r - avg) / avg <= CONSISTENCY_TOLERANCE);
  return consistent ? { factor: avg, sampleSize: ratios.length } : null;
}

const RULE_SCHEMA: ToolDefinition = {
  name: "draft_alert_rules",
  description: "Draft alert rules for this service from its real baseline.",
  parameters: {
    type: "object",
    properties: {
      rules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            signal_type: { type: "string", enum: ["trace_latency", "trace_error_rate", "log_error_rate"] },
            operator: { type: "string", enum: ["gt"] },
            threshold: { type: "number" },
            threshold_unit: { type: "string" },
            window_minutes: { type: "number" },
            rationale: { type: "string" },
            evidence_stats_used: { type: "array", items: { type: "string" } },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            needs_human_input: { type: "boolean" },
            clarifying_question: { type: ["string", "null"] },
            policy_ids_applied: {
              type: "array",
              items: { type: "string" },
              description: "id(s) of activePolicies that concretely shaped this rule's threshold/window/quiet_hours — empty if none applied. Never claim a policy applied in rationale without listing its id here.",
            },
            quiet_hours_start_hour: { type: ["number", "null"], description: "0-23, local hour a policy-derived suppression window starts, or null if no policy imposes one." },
            quiet_hours_end_hour: { type: ["number", "null"], description: "0-23, local hour the suppression window ends." },
          },
          required: ["signal_type", "operator", "threshold", "threshold_unit", "window_minutes", "rationale", "confidence"],
        },
      },
    },
    required: ["rules"],
  },
};

export async function draftRulesForService(
  serviceId: string,
  criticality: AlertCriticality,
  baseline: ServiceBaseline,
  confirmedAnomalyOverride = false,
): Promise<DraftedRule[]> {
  // A real gap caught live: this deterministic gate had no way to be
  // overridden once a human actually answered its own clarifying
  // question — it kept re-asking the identical question every cycle for
  // as long as the underlying data stayed anomalous (which, mid-incident,
  // is indefinitely), silently discarding the answer. `run.ts` now checks
  // for a real answered baseline_anomaly question for this service before
  // calling this function and passes that through here — an explicit
  // "proceed anyway" unblocks drafting (still flagged low-confidence
  // below), it doesn't just get ignored forever.
  if (baselineLooksAnomalous(baseline) && !confirmedAnomalyOverride) {
    return [
      {
        serviceId,
        signalType: "baseline_anomaly",
        needsHumanInput: true,
        rationale: `p99 (${baseline.latencyP99Ms.value}ms) is over ${ANOMALOUS_P99_P50_RATIO}x p50 (${baseline.latencyP50Ms.value}ms) in the 15-minute baseline window — this usually means the window itself caught an incident, not normal behavior.`,
        clarifyingQuestion: `${BASELINE_ANOMALY_MARKER}"${serviceId}"'s baseline window looks anomalous (p99/p50 ratio far past normal) — was something already wrong with this service in the last 15 minutes? If so, when would be a cleaner window to baseline against?`,
      },
    ];
  }

  const [latencyFactor, errorFactor, logFactor, activePolicies] = await Promise.all([
    learnedCorrectionFactor("trace_latency"),
    learnedCorrectionFactor("trace_error_rate"),
    learnedCorrectionFactor("log_error_rate"),
    listActivePolicies(),
  ]);

  const skillDoc = await loadSkillDoc("alerting");
  const llm = getLLMClient();

  const { toolCalls } = await llm.chat({
    messages: [
      {
        role: "system",
        content:
          skillDoc +
          "\n\nThreshold formula: for trace_latency, threshold = p99 baseline × criticality margin " +
          "(critical 1.3x, high 1.5x, medium 1.8x, low 2.2x). If an error-rate baseline is a real " +
          "zero (not missing/null), still propose a rule using a criticality-tier floor instead of " +
          "a zero threshold: trace_error_rate fraction — critical 0.01, high 0.02, medium 0.05, low " +
          "0.10; log_error_rate lines/min — critical 5, high 10, medium 20, low 40 (flag confidence " +
          "'low' when you use a floor instead of a real baseline). A learned_correction_factor is " +
          "informational context only — the system applies it deterministically after your draft, " +
          "don't try to apply it yourself." +
          (confirmedAnomalyOverride
            ? " NOTE: a human explicitly confirmed this service's baseline window is contaminated " +
              "by a real ongoing issue and asked to proceed anyway — prefer a criticality-tier floor " +
              "over the (unreliable) observed baseline for every signal here, and flag confidence 'low'."
            : "") +
          "\n\nactivePolicies (if any) are binding human house rules in plain English, not " +
          "suggestions. For EVERY policy in activePolicies, explicitly decide whether it applies to " +
          "THIS rule's exact service+signal_type — a policy about 'error-rate paging' for a service " +
          "covers that service's trace_error_rate AND log_error_rate rules both, not just the one " +
          "signal type you happen to be most confident about. If it applies, adjust threshold, " +
          "window_minutes, and/or quiet_hours_start_hour/end_hour so the rule actually satisfies it, " +
          "list that policy's id in policy_ids_applied, and say plainly in rationale how it changed " +
          "the number (e.g. 'raised threshold to 2.0x per policy policy_123: only page for sustained " +
          "spikes'). If it does NOT apply, you must still say so explicitly in rationale (e.g. 'policy " +
          "policy_123 is about latency, not relevant to this error-rate rule') — a rationale that " +
          "mentions threshold/criticality but never addresses a given activePolicies entry at all is " +
          "an unacceptable silent ignore, even if your final decision not to apply it turns out right. " +
          "If a policy clearly should apply but you can't mechanically satisfy it via threshold/window/" +
          "quiet_hours alone, set needs_human_input true and explain the conflict in clarifying_question " +
          "instead of guessing.",
      },
      {
        role: "user",
        content: JSON.stringify({
          service: serviceId,
          criticality,
          criticality_source: "telemetry_label_or_human_answer",
          baseline,
          learned_correction_factor_by_signal: {
            trace_latency: latencyFactor,
            trace_error_rate: errorFactor,
            log_error_rate: logFactor,
          },
          activePolicies: activePolicies.map((p) => ({ id: p.id, text: p.text })),
        }),
      },
    ],
    tools: [RULE_SCHEMA],
  });

  const call = toolCalls[0];
  if (!call || !Array.isArray((call.arguments as any).rules)) return [];

  const factorBySignal: Record<string, { factor: number; sampleSize: number } | null> = {
    trace_latency: latencyFactor,
    trace_error_rate: errorFactor,
    log_error_rate: logFactor,
  };

  return ((call.arguments as any).rules as any[]).map((r): DraftedRule => {
    // A real crash was caught live here: the schema lets the LLM flag a
    // per-rule needs_human_input with threshold left null when it doesn't
    // have enough to propose a number — that's a legitimate response, not
    // a malformed one, and this code was blindly proceeding as if
    // threshold were always a real number, crashing downstream on
    // `.toFixed()`. Must be handled explicitly, the same way the
    // deterministic baseline-anomaly check above is.
    if (r.needs_human_input || typeof r.threshold !== "number" || Number.isNaN(r.threshold)) {
      return {
        serviceId,
        signalType: r.signal_type,
        needsHumanInput: true,
        rationale: r.rationale ?? "Model flagged this rule as needing human input before a threshold can be set.",
        clarifyingQuestion:
          r.clarifying_question ?? `"${serviceId}"'s ${r.signal_type} rule needs a decision I can't make from evidence alone — ${r.rationale ?? "can you confirm how to proceed?"}`,
      };
    }

    const factor = factorBySignal[r.signal_type];
    // Deterministic application, never trusting the LLM's own arithmetic —
    // same "don't trust the model's arithmetic" pattern as tuning.ts's
    // directional guard.
    const threshold = factor ? r.threshold * factor.factor : r.threshold;
    const appliedPolicyIds: string[] = Array.isArray(r.policy_ids_applied) ? r.policy_ids_applied : [];
    // Defense in depth, same shape as the invalid-service_id guard in
    // recommendations.ts: never let a claimed policy id point at nothing —
    // Auditability breaks the moment a citation can't be resolved.
    const validPolicyIds = appliedPolicyIds.filter((id) => activePolicies.some((p) => p.id === id));
    const quietHours =
      typeof r.quiet_hours_start_hour === "number" && typeof r.quiet_hours_end_hour === "number"
        ? { startHour: r.quiet_hours_start_hour, endHour: r.quiet_hours_end_hour }
        : null;
    return {
      serviceId,
      signalType: r.signal_type,
      criticality,
      operator: "gt",
      threshold,
      thresholdUnit: r.threshold_unit,
      windowMinutes: r.window_minutes,
      rationale: r.rationale + (factor ? ` [learned correction ${factor.factor.toFixed(2)}x applied, n=${factor.sampleSize}]` : ""),
      evidenceStatsUsed: r.evidence_stats_used ?? [],
      confidence: r.confidence,
      needsHumanInput: false,
      appliedPolicyIds: validPolicyIds,
      quietHours,
    };
  });
}
