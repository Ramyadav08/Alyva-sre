import { NextRequest, NextResponse } from "next/server";
import { listProposals, DECIDED_STATUSES } from "@/lib/proposals";
import type { ProposalKind, ProposalStatus } from "@/lib/models";

export async function GET(req: NextRequest) {
  const statusParam = req.nextUrl.searchParams.get("status");
  const kind = req.nextUrl.searchParams.get("kind") as ProposalKind | null;
  // "decided" is a pseudo-status: any proposal a human has actually acted on
  // (approved/rejected/applied/apply_failed) — used by the read-only "recently
  // decided" list, as opposed to a single real ProposalStatus like "pending".
  const status: ProposalStatus | ProposalStatus[] | undefined =
    statusParam === "decided" ? DECIDED_STATUSES : (statusParam as ProposalStatus | null) ?? undefined;
  const proposals = await listProposals({ status, kind: kind ?? undefined });
  return NextResponse.json({ proposals });
}
