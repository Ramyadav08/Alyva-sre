import { NextResponse } from "next/server";
import { runRetuneSweep } from "@/lib/alert-rules/run";

/**
 * The self-correction cycle over already-active rules — separate from
 * /run, since re-tuning an approved rule is a different job than drafting
 * a brand-new one (same split as Ramya's run.js/proposeRetune).
 */
export async function POST() {
  try {
    const result = await runRetuneSweep();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[alert-rules/retune-sweep] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
