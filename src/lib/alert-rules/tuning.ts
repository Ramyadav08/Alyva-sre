/**
 * Self-tuning, ported from tuning.js — the core of the self-correcting
 * alert-rule skill. Two entry points:
 *
 * - refineDraftViaBacktest: runs BEFORE a human ever sees a drafted rule
 *   ("the agent doing its own homework" — iterating silently here is
 *   fine, since nothing has been shown to anyone yet).
 * - proposeRetune: runs on an already-approved, live rule. Produces
 *   exactly one Proposal, never applies anything itself — the hard rule
 *   this whole skill exists to prove: self-correction never touches the
 *   thing being observed, only the rule's own threshold/window, and even
 *   that only after a human approves it again.
 *
 * candidateThreshold is deliberately NOT an LLM call — ported comment
 * from tuning.js explains why: an LLM asked to invent a new threshold
 * from scratch repeatedly moved it the WRONG direction (loosening a "gt"
 * threshold by raising it when it should lower, etc.). A percentile of
 * real historical values is directionally guaranteed correct by
 * construction; the LLM's job (in proposeAdjustment) is judgment about
 * how far to move from that candidate, not arithmetic — and even that is
 * guarded in code, not just by prompting.
 */
import { getLLMClient, type ToolDefinition } from "../llm";
import { loadSkillDoc } from "../skills";
import { backtestRule } from "./backtest";
import type { AlertBacktestResult, AlertRule, AlertRulePayload } from "../models";

const OUTLIER_MULTIPLE = 5;
const MAX_EXCLUDED_FRACTION = 0.5;
const DEFAULT_CEILING = 0.05;

function excludeIncidentPeriods(values: number[], operator: "gt" | "lt"): number[] | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const clean =
    operator === "gt" ? values.filter((v) => v <= median * OUTLIER_MULTIPLE) : values.filter((v) => v >= median / OUTLIER_MULTIPLE);
  if (values.length > 0 && clean.length / values.length < 1 - MAX_EXCLUDED_FRACTION) {
    return null; // excluding outliers would drop too much — refuse to calibrate
  }
  return clean;
}

/** The value at the (1 - ceiling) percentile of clean historical samples — directionally guaranteed correct, per the comment above. */
export function candidateThreshold(
  rule: { operator: "gt" | "lt" },
  backtestResult: AlertBacktestResult,
  ceiling = DEFAULT_CEILING,
): number | null {
  const values = backtestResult.rawValues;
  if (!values || values.length === 0) return null;
  const clean = excludeIncidentPeriods(values, rule.operator);
  if (!clean || clean.length === 0) return null;

  const sorted = [...clean].sort((a, b) => a - b);
  const n = sorted.length;
  if (rule.operator === "gt") {
    const idx = Math.min(n - 1, Math.max(0, Math.ceil((1 - ceiling) * n) - 1));
    return sorted[idx];
  }
  const idx = Math.min(n - 1, Math.max(0, Math.floor(ceiling * n)));
  return sorted[idx];
}

type AdjustmentResult = {
  giveUp: boolean;
  newThreshold: number | null;
  newWindowMinutes: number | null;
  rationale: string;
  questionIfGiveUp?: string;
};

const ADJUSTMENT_TOOL: ToolDefinition = {
  name: "propose_adjustment",
  description:
    "Propose a new threshold/window for this alert rule, or give up and ask a clarifying question if you can't confidently adjust it.",
  parameters: {
    type: "object",
    properties: {
      give_up: { type: "boolean" },
      new_threshold: { type: ["number", "null"] },
      new_window_minutes: { type: ["number", "null"] },
      rationale: { type: "string" },
      question_if_give_up: { type: ["string", "null"] },
    },
    required: ["give_up", "rationale"],
  },
};

export async function proposeAdjustment(
  rule: AlertRulePayload & { threshold: number; windowMinutes: number },
  backtestResult: AlertBacktestResult,
): Promise<AdjustmentResult> {
  const candidate = candidateThreshold(rule, backtestResult);
  if (candidate === null) {
    return {
      giveUp: true,
      newThreshold: null,
      newWindowMinutes: null,
      rationale: "No clean historical baseline to calibrate against (too much of the window looks like real incidents).",
      questionIfGiveUp: `Backtesting "${rule.serviceId}"'s ${rule.signalType} rule found too much of the last 24h looks anomalous to safely calibrate a new threshold. Can you confirm a normal time range to baseline against, or should the current threshold (${rule.threshold}) stand as-is?`,
    };
  }

  const skillDoc = await loadSkillDoc("alerting");
  const llm = getLLMClient();
  const { toolCalls } = await llm.chat({
    messages: [
      { role: "system", content: skillDoc + "\n\nYour job here is judgment about how far to move from the statistically-computed candidate threshold, not arithmetic — never invent a new number from scratch." },
      {
        role: "user",
        content: JSON.stringify({
          service: rule.serviceId,
          signal_type: rule.signalType,
          criticality: rule.criticality,
          operator: rule.operator,
          current_threshold: rule.threshold,
          current_window_minutes: rule.windowMinutes,
          statistically_computed_candidate_threshold: candidate,
          backtest: {
            verdict: backtestResult.verdict,
            fraction_above: backtestResult.fractionAbove,
            corroborated_fraction: backtestResult.corroboratedFraction,
          },
        }),
      },
    ],
    tools: [ADJUSTMENT_TOOL],
  });

  const call = toolCalls[0];
  if (!call) {
    return { giveUp: true, newThreshold: null, newWindowMinutes: null, rationale: "Model returned no decision." };
  }
  const args = call.arguments as Record<string, unknown>;
  if (args.give_up) {
    return {
      giveUp: true,
      newThreshold: null,
      newWindowMinutes: null,
      rationale: String(args.rationale ?? ""),
      questionIfGiveUp: (args.question_if_give_up as string) ?? undefined,
    };
  }

  let newThreshold = Number(args.new_threshold);
  const newWindowMinutes = args.new_window_minutes ? Number(args.new_window_minutes) : rule.windowMinutes;

  // Directional guard — structural, not just prompted: the LLM's proposed
  // move must agree with the candidate's own move relative to the current
  // threshold — including "the candidate says don't move at all"
  // (candidateDir === 0). A live run caught the gap in a narrower version
  // of this guard (only checking disagreement between two *nonzero*
  // directions): checkout's error-rate rule had a candidate of 0 (all-zero
  // historical samples, "don't move"), so candidateDir was 0, the earlier
  // guard treated that as "unconstrained," and the LLM's own proposed 1.0
  // sailed through untouched — a threshold of 100% error rate is a
  // functionally dead rule. Any disagreement now clamps, not just
  // nonzero-vs-nonzero disagreement.
  const candidateDir = Math.sign(candidate - rule.threshold);
  const proposedDir = Math.sign(newThreshold - rule.threshold);
  let rationale = String(args.rationale ?? "");
  if (proposedDir !== candidateDir) {
    newThreshold = candidate;
    rationale += ` [guard: proposed direction disagreed with the statistical candidate; clamped to ${candidate}]`;
  }

  return { giveUp: false, newThreshold, newWindowMinutes, rationale };
}

export type RefineResult = {
  status: "draft_ready" | "needs_input" | "draft";
  finalThreshold: number;
  finalWindowMinutes: number;
  tuningHistory: Array<{ iteration: number; beforeThreshold: number; afterThreshold: number; beforeWindowMinutes: number; afterWindowMinutes: number; reason: string; backtestBefore: string }>;
  lastBacktest: AlertBacktestResult;
  openQuestion?: string;
};

/** Pre-approval loop — iterates silently (nothing shown to a human yet), up to maxIterations. */
export async function refineDraftViaBacktest(
  rule: AlertRulePayload & { threshold: number; windowMinutes: number },
  { maxIterations = 4, hoursBack = 24 }: { maxIterations?: number; hoursBack?: number } = {},
): Promise<RefineResult> {
  let current = { threshold: rule.threshold, windowMinutes: rule.windowMinutes };
  const tuningHistory: RefineResult["tuningHistory"] = [];
  let lastBacktest: AlertBacktestResult | null = null;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const backtest = await backtestRule({ ...rule, ...current }, hoursBack);
    lastBacktest = backtest;

    if (backtest.verdict === "untestable" || backtest.verdict === "no_historical_data" || backtest.verdict === "query_failed") {
      return { status: "draft", finalThreshold: current.threshold, finalWindowMinutes: current.windowMinutes, tuningHistory, lastBacktest: backtest };
    }
    if (backtest.verdict === "acceptable" || backtest.verdict === "never_fired_in_window") {
      return { status: "draft_ready", finalThreshold: current.threshold, finalWindowMinutes: current.windowMinutes, tuningHistory, lastBacktest: backtest };
    }
    if (backtest.verdict === "frequent_but_corroborated") {
      return {
        status: "needs_input",
        finalThreshold: current.threshold,
        finalWindowMinutes: current.windowMinutes,
        tuningHistory,
        lastBacktest: backtest,
        openQuestion: `"${rule.serviceId}"'s ${rule.signalType} rule fires ${((backtest.fractionAbove ?? 0) * 100).toFixed(0)}% of the last ${hoursBack}h, but that firing is corroborated by real ${otherSignalLabel(rule.signalType)} evidence most of the time — these look like real incidents, not noise. Is that firing frequency itself acceptable, or does this service have a deeper problem worth investigating separately?`,
      };
    }

    // likely_noisy
    const adjustment = await proposeAdjustment({ ...rule, ...current }, backtest);
    if (adjustment.giveUp || adjustment.newThreshold === null) {
      return {
        status: "needs_input",
        finalThreshold: current.threshold,
        finalWindowMinutes: current.windowMinutes,
        tuningHistory,
        lastBacktest: backtest,
        openQuestion: adjustment.questionIfGiveUp ?? adjustment.rationale,
      };
    }

    tuningHistory.push({
      iteration,
      beforeThreshold: current.threshold,
      afterThreshold: adjustment.newThreshold,
      beforeWindowMinutes: current.windowMinutes,
      afterWindowMinutes: adjustment.newWindowMinutes ?? current.windowMinutes,
      reason: adjustment.rationale,
      backtestBefore: backtest.verdict,
    });
    current = { threshold: adjustment.newThreshold, windowMinutes: adjustment.newWindowMinutes ?? current.windowMinutes };
  }

  const final = await backtestRule({ ...rule, ...current }, hoursBack);
  return {
    status: final.verdict === "acceptable" || final.verdict === "never_fired_in_window" ? "draft_ready" : "needs_input",
    finalThreshold: current.threshold,
    finalWindowMinutes: current.windowMinutes,
    tuningHistory,
    lastBacktest: final,
    openQuestion:
      final.verdict === "acceptable" || final.verdict === "never_fired_in_window"
        ? undefined
        : `Ran ${maxIterations} tuning iterations on "${rule.serviceId}"'s ${rule.signalType} rule, still noisy (${((final.fractionAbove ?? 0) * 100).toFixed(0)}% of window). Needs a human look rather than another automated pass.`,
  };
}

function otherSignalLabel(signalType: string): string {
  return signalType === "trace_latency" ? "error-rate" : "log";
}

export type RetuneResult = { needsRetune: false } | { needsRetune: true; backtest: AlertBacktestResult; proposal: AdjustmentResult };

/** Post-approval sweep — single backtest, single proposal, never auto-applied. */
export async function proposeRetune(activeRule: AlertRule, hoursBack = 24): Promise<RetuneResult> {
  const backtest = await backtestRule(activeRule, hoursBack);
  if (backtest.verdict !== "likely_noisy") return { needsRetune: false };
  const proposal = await proposeAdjustment(activeRule, backtest);
  return { needsRetune: true, backtest, proposal };
}
