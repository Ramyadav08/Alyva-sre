import { NextRequest, NextResponse } from "next/server";
import { decideProposal, editProposal } from "@/lib/proposals";
import { applyProposal } from "@/lib/apply-proposal";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { decision, note, editedPayload } = body ?? {};

  if (editedPayload !== undefined) {
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

  return NextResponse.json({ proposal });
}
