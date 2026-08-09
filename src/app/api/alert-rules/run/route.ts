import { NextResponse } from "next/server";
import { runAlertRulesCycle } from "@/lib/alert-rules/run";

/** Called on dashboard load, not a button — Agency, same as onboarding's /run. */
export async function POST() {
  try {
    const result = await runAlertRulesCycle();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[alert-rules/run] failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
