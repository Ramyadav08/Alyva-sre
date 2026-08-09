/**
 * The generic draft-then-approve envelope. Every skill creates Proposals
 * through `createProposal` and nothing else — there is deliberately no
 * function anywhere in this file (or called by it) that writes a real
 * effect (an active AlertRule, a confirmed ServiceProfile, an opened PR)
 * except `applyProposal`, and that only runs after `status === 'approved'`.
 * This mirrors the reference platform's own McpProposal rule: "only an
 * explicit approve calls the real service with the stored payload."
 */
import { getDb, newId, nowIso } from "./store";
import type { EvidenceRef, Proposal, ProposalKind, ProposalStatus } from "./models";

export async function createProposal<T>(args: {
  kind: ProposalKind;
  serviceId?: string;
  summary: string;
  payload: T;
  rationale: string;
  evidence: EvidenceRef[];
}): Promise<Proposal<T>> {
  const db = await getDb();
  const now = nowIso();
  const proposal: Proposal<T> = {
    id: newId("prop"),
    kind: args.kind,
    serviceId: args.serviceId,
    summary: args.summary,
    payload: args.payload,
    rationale: args.rationale,
    evidence: args.evidence,
    status: "pending",
    history: [{ status: "pending", payload: args.payload, at: now }],
    createdAt: now,
    updatedAt: now,
  };
  db.data.proposals.push(proposal as unknown as Proposal);
  await db.write();
  return proposal;
}

/** Terminal states — a decision has actually been made, one way or another. */
export const DECIDED_STATUSES: ProposalStatus[] = ["approved", "rejected", "applied", "apply_failed"];

export async function listProposals(filter?: { status?: ProposalStatus | ProposalStatus[]; kind?: ProposalKind }) {
  const db = await getDb();
  const statuses = filter?.status === undefined ? undefined : Array.isArray(filter.status) ? filter.status : [filter.status];
  return db.data.proposals.filter(
    (p) => (!statuses || statuses.includes(p.status)) && (!filter?.kind || p.kind === filter.kind),
  );
}

/** Human edits the drafted payload before approving — the modify step the real platform lacks. */
export async function editProposal(id: string, newPayload: unknown, note?: string): Promise<Proposal | null> {
  const db = await getDb();
  const proposal = db.data.proposals.find((p) => p.id === id);
  if (!proposal) return null;
  proposal.payload = newPayload;
  proposal.status = "edited";
  proposal.updatedAt = nowIso();
  proposal.history.push({ status: "edited", payload: newPayload, at: proposal.updatedAt, note });
  await db.write();
  return proposal;
}

export async function decideProposal(
  id: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<Proposal | null> {
  const db = await getDb();
  const proposal = db.data.proposals.find((p) => p.id === id);
  if (!proposal) return null;
  proposal.status = decision;
  proposal.updatedAt = nowIso();
  proposal.history.push({ status: decision, payload: proposal.payload, at: proposal.updatedAt, note });
  await db.write();
  return proposal;
}

/** Marks a proposal applied, recording the id of whatever real record it produced. */
export async function markApplied(id: string, appliedEntityId: string): Promise<void> {
  const db = await getDb();
  const proposal = db.data.proposals.find((p) => p.id === id);
  if (!proposal) return;
  proposal.status = "applied";
  proposal.appliedEntityId = appliedEntityId;
  proposal.updatedAt = nowIso();
  proposal.history.push({ status: "applied", payload: proposal.payload, at: proposal.updatedAt });
  await db.write();
}

export async function markApplyFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  const proposal = db.data.proposals.find((p) => p.id === id);
  if (!proposal) return;
  proposal.status = "apply_failed";
  proposal.applyError = error;
  proposal.updatedAt = nowIso();
  proposal.history.push({ status: "apply_failed", payload: proposal.payload, at: proposal.updatedAt, note: error });
  await db.write();
}
