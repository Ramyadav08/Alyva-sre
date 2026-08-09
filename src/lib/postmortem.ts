/**
 * Rung 6: "Writes it up, unprompted." Triggered from exactly one place —
 * recovery-check.ts, the instant a recovery verdict is confirmed
 * "recovered" — never on request, never a fixed template. Every section
 * is built from this specific proposal's own real evidence trail (its
 * history, its before/after recovery evidence, the service's real
 * business-context answer) so two different incidents produce two
 * genuinely different postmortems, not the same shape restated.
 */
import { getDb, newId, nowIso } from "./store";
import { getLLMClient, type ToolDefinition } from "./llm";
import type { Postmortem, Proposal, EvidenceRef } from "./models";

const POSTMORTEM_TOOL: ToolDefinition = {
  name: "write_postmortem",
  description: "Write a concise, evidence-grounded postmortem for this specific resolved incident.",
  parameters: {
    type: "object",
    properties: {
      headline: { type: "string", description: "2-3 lines max, the summary a stakeholder reads first." },
      timeline: {
        type: "array",
        items: { type: "object", properties: { at: { type: "string" }, event: { type: "string" } }, required: ["at", "event"] },
      },
      root_cause: { type: "string" },
      actions_taken: { type: "string" },
      long_term_fixes: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "timeline", "root_cause", "actions_taken", "long_term_fixes"],
  },
};

export async function generatePostmortemForProposal(proposal: Proposal): Promise<Postmortem | null> {
  const db = await getDb();
  db.data.postmortems ??= [];

  if (db.data.postmortems.some((p) => p.proposalId === proposal.id)) return null; // already written for this one

  const profile = proposal.serviceId ? db.data.serviceProfiles.find((p) => p.serviceId === proposal.serviceId) : undefined;
  const llm = getLLMClient();

  const { toolCalls } = await llm.chat({
    messages: [
      {
        role: "system",
        content:
          "Write a real postmortem from this specific incident's own history — never a generic " +
          "template. Every claim must trace to something in the provided history/evidence. " +
          "Headline first (2-3 lines), then timeline/root cause/actions/long-term fixes.",
      },
      {
        role: "user",
        content: JSON.stringify({
          service: proposal.serviceId,
          proposal_summary: proposal.summary,
          proposal_rationale: proposal.rationale,
          business_context: profile?.businessContext ?? null,
          history: proposal.history,
          original_evidence: proposal.evidence,
          recovery_check: proposal.recoveryCheck,
        }),
      },
    ],
    tools: [POSTMORTEM_TOOL],
  });

  const call = toolCalls[0];
  if (!call) return null;
  const args = call.arguments as Record<string, unknown>;

  const revenuePerMinute = profile?.businessContext.revenuePerIncidentMinuteUsd ?? null;
  const detectedAt = proposal.history[0]?.at ?? proposal.createdAt;
  const recoveredAt = proposal.recoveryCheck?.checkedAt ?? proposal.updatedAt;
  const durationMinutes = Math.max(0, (new Date(recoveredAt).getTime() - new Date(detectedAt).getTime()) / 60_000);
  const businessImpactEstimateUsd = revenuePerMinute !== null ? Math.round(revenuePerMinute * durationMinutes) : null;

  const evidence: EvidenceRef[] = [...proposal.evidence, ...(proposal.recoveryCheck?.afterEvidence ?? [])];

  const postmortem: Postmortem = {
    id: newId("pm"),
    proposalId: proposal.id,
    serviceId: proposal.serviceId ?? "unknown",
    headline: String(args.headline ?? ""),
    timeline: (args.timeline as Array<{ at: string; event: string }>) ?? [],
    rootCause: String(args.root_cause ?? ""),
    actionsTaken: String(args.actions_taken ?? ""),
    longTermFixes: (args.long_term_fixes as string[]) ?? [],
    businessImpactEstimateUsd,
    evidence,
    createdAt: nowIso(),
  };

  db.data.postmortems.push(postmortem);
  await db.write();
  return postmortem;
}
