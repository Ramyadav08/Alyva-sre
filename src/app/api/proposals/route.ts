import { NextRequest, NextResponse } from "next/server";
import { listProposals } from "@/lib/proposals";
import type { ProposalKind, ProposalStatus } from "@/lib/models";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") as ProposalStatus | null;
  const kind = req.nextUrl.searchParams.get("kind") as ProposalKind | null;
  const proposals = await listProposals({ status: status ?? undefined, kind: kind ?? undefined });
  return NextResponse.json({ proposals });
}
