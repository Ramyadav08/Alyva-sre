import { NextRequest, NextResponse } from "next/server";
import { decideProposal, editProposal } from "@/lib/proposals";
import { applyProposal } from "@/lib/apply-proposal";
import { recordProposalLesson } from "@/lib/skills";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { decision, note, editedPayload } = body ?? {};
  const wasEdited = editedPayload !== undefined;

  if (wasEdited) {
    await editProposal(id, editedPayload, note);
  }

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }

  const proposal = await decideProposal(id, decision, note);
  if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (decision === "approved") {
    await applyProposal(proposal);
  }

  // The self-learning half of this loop: every real decision appends to
  // the relevant skill doc's Lessons learned log, not just the Proposal's
  // own history — see recordProposalLesson.
  await recordProposalLesson({
    kind: proposal.kind,
    serviceId: proposal.serviceId,
    summary: proposal.summary,
    decision,
    wasEdited,
    note,
  });

  return NextResponse.json({ proposal });
}
