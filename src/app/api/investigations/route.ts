import { NextResponse } from "next/server";
import { listJsInvestigations } from "@/lib/js-skills-bridge";

/** Read-only bridge into the plain-JS Detection & RCA skill's real output — see js-skills-bridge.ts. */
export async function GET() {
  const investigations = await listJsInvestigations();
  return NextResponse.json({ investigations });
}
