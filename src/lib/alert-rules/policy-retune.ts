/**
 * Stretch 8, the other half: draft.ts covers policies at draft time, but
 * "Agency: policy consulted unprompted on every draft" would be a weak
 * claim if an *already-active* rule never got reconsidered against a
 * policy added after it went live. This sweep runs on every alert-rules
 * cycle (same unprompted trigger as the noise-driven retune sweep in
 * run.ts) and checks each active rule against every active policy it
 * hasn't already applied — a real structural effect on real rules, not a
 * one-time demo hook.
 *
 * Deliberately separate from tuning.ts's noise-driven proposeRetune: the
 * trigger here is "a policy exists that this rule hasn't considered," not
 * "this rule's firing history looks noisy" — different question, different
 * tool schema, same Proposal-then-approve output shape.
 */
import { getDb, nowIso } from "../store";
import { getLLMClient, type ToolDefinition } from "../llm";
import { listActivePolicies } from "../alert-policies";
import { askQuestion } from "../questions";
import { createProposal } from "../proposals";
import type { AlertRule, AlertRulePayload } from "../models";

const POLICY_ASSESS_TOOL: ToolDefinition = {
  name: "assess_policies_against_rule",
  description: "Decide whether each given policy concretely applies to this specific alert rule, and if so how to adjust it.",
  parameters: {
    type: "object",
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            policy_id: { type: "string" },
            applies: { type: "boolean" },
            new_threshold: { type: ["number", "null"], description: "Only if applies and a threshold change is needed to satisfy the policy." },
            new_window_minutes: { type: ["number", "null"] },
            new_quiet_hours_start_hour: { type: ["number", "null"] },
            new_quiet_hours_end_hour: { type: ["number", "null"] },
            rationale: { type: "string", description: "Why this policy does or doesn't apply to this exact rule — never a bare yes/no." },
          },
          required: ["policy_id", "applies", "rationale"],
        },
      },
    },
    required: ["decisions"],
  },
};

export async function runPolicySweep(): Promise<{ results: Array<{ ruleId: string; action: string }> }> {
  const db = await getDb();
  const activePolicies = await listActivePolicies();
  const results: Array<{ ruleId: string; action: string }> = [];

  if (activePolicies.length === 0) return { results };

  for (const rule of db.data.alertRules) {
    if (rule.status !== "active") continue;
    const unapplied = activePolicies.filter((p) => !(rule.appliedPolicyIds ?? []).includes(p.id));
    if (unapplied.length === 0) {
      results.push({ ruleId: rule.id, action: "no_new_policy" });
      continue;
    }
    const hasPendingRetune = db.data.proposals.some(
      (p) => p.kind === "alert_rule" && (p.payload as AlertRulePayload).retuneOfRuleId === rule.id && (p.status === "pending" || p.status === "edited"),
    );
    if (hasPendingRetune) {
      results.push({ ruleId: rule.id, action: "skipped_pending_retune" });
      continue;
    }

    const llm = getLLMClient();
    const { toolCalls } = await llm.chat({
      messages: [
        {
          role: "system",
          content:
            "You are checking whether newly-added human alerting policies (plain-English house rules) " +
            "concretely apply to one specific already-active alert rule. Only mark applies=true when the " +
            "policy's text is genuinely about this service/signal (e.g. a policy naming 'payments' does not " +
            "apply to a 'cart' service's rule unless the policy text says otherwise). When it applies, adjust " +
            "threshold/window_minutes/quiet_hours only as far as needed to satisfy the policy — never invent " +
            "an unrelated change while you're at it.",
        },
        {
          role: "user",
          content: JSON.stringify({
            rule: {
              serviceId: rule.serviceId,
              signalType: rule.signalType,
              criticality: rule.criticality,
              operator: rule.operator,
              currentThreshold: rule.threshold,
              currentThresholdUnit: rule.thresholdUnit,
              currentWindowMinutes: rule.windowMinutes,
              currentQuietHours: rule.quietHours,
            },
            policiesToConsider: unapplied.map((p) => ({ id: p.id, text: p.text })),
          }),
        },
      ],
      tools: [POLICY_ASSESS_TOOL],
    });

    const call = toolCalls[0];
    const decisions = Array.isArray((call?.arguments as any)?.decisions) ? (call!.arguments as any).decisions : [];
    const applying = decisions.filter((d: any) => d.applies && unapplied.some((p) => p.id === d.policy_id));

    if (applying.length === 0) {
      // Considered, none applied. Deliberately NOT written to the rule
      // directly — an AlertRule is only ever mutated via an approved
      // Proposal (apply-proposal.ts), full stop, no bookkeeping exception.
      // The cost is re-asking about the same non-applicable policy on a
      // future sweep; that's a cheap, bounded LLM call, not a correctness
      // risk, and it keeps "grep for direct AlertRule writes outside
      // apply-proposal.ts" a real, checkable guardrail rather than one with
      // an asterisk.
      results.push({ ruleId: rule.id, action: "considered_none_applied" });
      continue;
    }

    const now = nowIso();
    let newThreshold = rule.threshold;
    let newWindowMinutes = rule.windowMinutes;
    let newQuietHours = rule.quietHours;
    const rationaleParts: string[] = [];
    const appliedTexts: string[] = [];
    for (const d of applying) {
      const policy = unapplied.find((p) => p.id === d.policy_id)!;
      appliedTexts.push(policy.text);
      rationaleParts.push(`policy "${policy.text}" (${policy.id}): ${d.rationale}`);
      if (typeof d.new_threshold === "number") newThreshold = d.new_threshold;
      if (typeof d.new_window_minutes === "number") newWindowMinutes = d.new_window_minutes;
      if (typeof d.new_quiet_hours_start_hour === "number" && typeof d.new_quiet_hours_end_hour === "number") {
        newQuietHours = { startHour: d.new_quiet_hours_start_hour, endHour: d.new_quiet_hours_end_hour };
      }
    }
    const allConsideredIds = unapplied.map((p) => p.id);
    const appliedIds = applying.map((d: any) => d.policy_id);

    await createProposal({
      kind: "alert_rule",
      serviceId: rule.serviceId,
      summary: `Policy-retune ${rule.signalType} rule for ${rule.serviceId} — applying: ${appliedTexts.join("; ")}`,
      payload: {
        serviceId: rule.serviceId,
        signalType: rule.signalType,
        criticality: rule.criticality,
        operator: rule.operator,
        threshold: newThreshold,
        thresholdUnit: rule.thresholdUnit,
        windowMinutes: newWindowMinutes,
        rationale: rationaleParts.join(" | "),
        evidenceStatsUsed: rule.evidenceStatsUsed,
        confidence: rule.confidence,
        retuneOfRuleId: rule.id,
        // Every policy considered this sweep — applied or not — is recorded
        // on approval, same reasoning as the considered_none_applied branch
        // above: don't re-litigate a policy this rule already reasoned about.
        appliedPolicyIds: [...new Set([...(rule.appliedPolicyIds ?? []), ...allConsideredIds])],
        quietHours: newQuietHours,
      } satisfies AlertRulePayload,
      rationale: rationaleParts.join(" | "),
      evidence: [
        {
          type: "log",
          query: `alertPolicies applied to active rule ${rule.id}`,
          summary: `${rule.threshold.toFixed(2)}${rule.thresholdUnit}/${rule.windowMinutes}m → ${newThreshold.toFixed(2)}${rule.thresholdUnit}/${newWindowMinutes}m, appliedIds=[${appliedIds.join(",")}]`,
          observedAt: now,
        },
      ],
    });
    results.push({ ruleId: rule.id, action: "policy_retune_proposed" });
  }

  return { results };
}
