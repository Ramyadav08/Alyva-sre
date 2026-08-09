import { NextResponse } from "next/server";
import { computeActiveBusinessImpact } from "@/lib/business-impact";

export async function GET() {
  const summary = await computeActiveBusinessImpact();
  return NextResponse.json(summary);
}
