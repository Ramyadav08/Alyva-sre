/**
 * Orchestration, ported from run.js: baseline → draft (LLM) → backtest +
 * tune loop → Proposal (or a Question, if genuinely stuck). Only drafts
 * for onboarded services with no existing rules yet — re-tuning
 * already-approved rules is the separate retune sweep below, not this
 * pipeline's job (same split as run.js/server.js).
 */
import { getServiceCriticalityLabel } from "../lgtm";
import { getDb, nowIso } from "../store";
import { askQuestion, listUnanswered } from "../questions";
import { createProposal } from "../proposals";
import { computeBaseline } from "./baseline";
import { draftRulesForService, BASELINE_ANOMALY_MARKER } from "./draft";
import { refineDraftViaBacktest } from "./tuning";
import { proposeRetune } from "./tuning";
import type { AlertCriticality, AlertRulePayload, EvidenceRef, ServiceProfile } from "../models";

function evidenceFromBaseline(serviceId: string, baseline: Awaited<ReturnType<typeof computeBaseline>>): EvidenceRef[] {
  const now = new Date().toISOString();
  const stats: EvidenceRef[] = [];
  const push = (label: string, stat: { value: number | null; promql: string }) => {
    if (stat.value !== null) stats.push({ type: "metric", query: stat.promql, summary: `${label} = ${stat.value.toFixed(3)}`, observedAt: now });
  };
  push("p99 latency (ms)", baseline.latencyP99Ms);
  push("p50 latency (ms)", baseline.latencyP50Ms);
  push("call rate (req/s)", baseline.callRatePerSec);
  push("error rate (fraction)", baseline.errorRateFraction);
  if (baseline.logErrorLinesPerMin) push("log error lines/min", baseline.logErrorLinesPerMin);
  return stats;
}

/** Real telemetry label first; falls back to the onboarding answer; asks rather than assumes if genuinely unknown. */
async function resolveCriticality(profile: ServiceProfile): Promise<AlertCriticality | null> {
  const label = await getServiceCriticalityLabel(profile.serviceId);
  if (label === "critical" || label === "high" || label === "medium" || label === "low") return label;

  switch (profile.businessContext.tier) {
    case "revenue_critical":
      return "critical";
    case "customer_facing":
      return "high";
    case "internal":
      return "low";
    default:
      return null; // genuinely unknown — caller asks, doesn't assume
  }
}

export async function runAlertRulesCycle() {
  const db = await getDb();
  const drafted: Array<{ serviceId: string; action: string }> = [];
  const pendingAlertingQuestions = await listUnanswered("alerting");

  for (const profile of db.data.serviceProfiles) {
    if (!profile.onboarded) continue;
    if (db.data.alertRules.some((r) => r.serviceId === profile.serviceId)) continue; // already has rules — not this pipeline's job
    // Real bugs caught live via an actual repeated run, not assumed: without
    // these two checks, every dashboard load before a service's rules (or
    // its blocking question) get resolved would re-draft from scratch and
    // spam duplicate proposals/questions — "has rules" above only looks at
    // applied AlertRules, not work still awaiting review or an answer.
    const hasPendingRuleProposal = db.data.proposals.some(
      (p) => p.kind === "alert_rule" && p.serviceId === profile.serviceId && (p.status === "pending" || p.status === "edited"),
    );
    if (hasPendingRuleProposal) continue;
    if (pendingAlertingQuestions.some((q) => q.serviceId === profile.serviceId)) {
      drafted.push({ serviceId: profile.serviceId, action: "skipped" });
      continue;
    }

    const criticality = await resolveCriticality(profile);
    if (!criticality) {
      await askQuestion({
        skill: "alerting",
        serviceId: profile.serviceId,
        prompt: `"${profile.serviceId}" has no real criticality signal (no telemetry label, no clear tier from onboarding) — what criticality should I use when drafting its alert rules: critical, high, medium, or low?`,
        context: profile.discovered.evidence,
      });
      drafted.push({ serviceId: profile.serviceId, action: "asked_criticality" });
      continue;
    }

    const baseline = await computeBaseline(profile.serviceId);
    const confirmedAnomalyOverride = db.data.questions.some(
      (q) => q.serviceId === profile.serviceId && q.answer && q.prompt.startsWith(BASELINE_ANOMALY_MARKER),
    );
    const draftedRules = await draftRulesForService(profile.serviceId, criticality, baseline, confirmedAnomalyOverride);

    for (const rule of draftedRules) {
      if (rule.needsHumanInput) {
        await askQuestion({ skill: "alerting", serviceId: profile.serviceId, prompt: rule.clarifyingQuestion, context: [] });
        drafted.push({ serviceId: profile.serviceId, action: "asked" });
        continue;
      }

      const refined = await refineDraftViaBacktest(rule, { hoursBack: 24 });
      const evidence = evidenceFromBaseline(profile.serviceId, baseline);
      const payload: AlertRulePayload = {
        serviceId: rule.serviceId,
        signalType: rule.signalType,
        criticality: rule.criticality,
        operator: rule.operator,
        threshold: refined.finalThreshold,
        thresholdUnit: rule.thresholdUnit,
        windowMinutes: refined.finalWindowMinutes,
        rationale: rule.rationale,
        evidenceStatsUsed: rule.evidenceStatsUsed,
        confidence: rule.confidence,
      };

      if (refined.status === "needs_input" && refined.openQuestion) {
        await askQuestion({ skill: "alerting", serviceId: profile.serviceId, prompt: refined.openQuestion, context: evidence });
        drafted.push({ serviceId: profile.serviceId, action: "asked" });
        continue;
      }

      const tuningNote =
        refined.tuningHistory.length > 0
          ? ` Self-tuned ${refined.tuningHistory.length}x before review (${refined.tuningHistory.map((h) => `${h.beforeThreshold.toFixed(1)}→${h.afterThreshold.toFixed(1)}`).join(", ")}).`
          : "";
      const untested = refined.status === "draft" ? " Not yet backtested (insufficient historical data) — evaluate its first live fires with extra scrutiny." : "";

      await createProposal({
        kind: "alert_rule",
        serviceId: profile.serviceId,
        summary: `${rule.signalType} rule for ${profile.serviceId} — ${rule.operator} ${refined.finalThreshold.toFixed(2)}${rule.thresholdUnit} over ${refined.finalWindowMinutes}m`,
        payload,
        rationale: rule.rationale + tuningNote + untested,
        evidence,
      });
      drafted.push({ serviceId: profile.serviceId, action: "proposed" });
    }
  }

  return { drafted };
}

/** Post-approval sweep over active rules — one Proposal per noisy rule, never auto-applied. */
export async function runRetuneSweep() {
  const db = await getDb();
  const results: Array<{ ruleId: string; action: string }> = [];

  for (const rule of db.data.alertRules) {
    if (rule.status !== "active") continue;
    const hasPendingRetune = db.data.proposals.some(
      (p) => p.kind === "alert_rule" && (p.payload as AlertRulePayload).retuneOfRuleId === rule.id && (p.status === "pending" || p.status === "edited"),
    );
    if (hasPendingRetune) continue;

    const outcome = await proposeRetune(rule, 24);
    if (!outcome.needsRetune) {
      results.push({ ruleId: rule.id, action: "no_retune_needed" });
      continue;
    }
    if (outcome.proposal.giveUp || outcome.proposal.newThreshold === null) {
      await askQuestion({
        skill: "alerting",
        serviceId: rule.serviceId,
        prompt: outcome.proposal.questionIfGiveUp ?? outcome.proposal.rationale,
        context: [],
      });
      results.push({ ruleId: rule.id, action: "asked" });
      continue;
    }

    const now = nowIso();
    await createProposal({
      kind: "alert_rule",
      serviceId: rule.serviceId,
      summary: `Retune ${rule.signalType} rule for ${rule.serviceId} — ${rule.threshold.toFixed(2)} → ${outcome.proposal.newThreshold.toFixed(2)}${rule.thresholdUnit}`,
      payload: {
        serviceId: rule.serviceId,
        signalType: rule.signalType,
        criticality: rule.criticality,
        operator: rule.operator,
        threshold: outcome.proposal.newThreshold,
        thresholdUnit: rule.thresholdUnit,
        windowMinutes: outcome.proposal.newWindowMinutes ?? rule.windowMinutes,
        rationale: outcome.proposal.rationale,
        evidenceStatsUsed: rule.evidenceStatsUsed,
        confidence: rule.confidence,
        retuneOfRuleId: rule.id,
      } satisfies AlertRulePayload,
      rationale: outcome.proposal.rationale,
      evidence: [
        {
          type: "metric",
          query: `backtest replay of ${rule.serviceId}'s active rule over the last 24h`,
          summary: `fired ${((outcome.backtest.fractionAbove ?? 0) * 100).toFixed(1)}% of the window, corroborated ${((outcome.backtest.corroboratedFraction ?? 0) * 100).toFixed(0)}% of fires`,
          observedAt: now,
        },
      ],
    });
    results.push({ ruleId: rule.id, action: "retune_proposed" });
  }

  return { results };
}
