import { NextResponse } from "next/server";
import { runOnboardingCycle } from "@/lib/onboarding";

/**
 * Called on dashboard load, not by a "Generate" button — this is what
 * makes discovery+interview unprompted (Agency), not click-triggered.
 */
export async function POST() {
  try {
    const result = await runOnboardingCycle();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[onboarding/run] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
