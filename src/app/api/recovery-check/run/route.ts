import { NextResponse } from "next/server";
import { runRecoveryChecks } from "@/lib/recovery-check";

/** Called on dashboard load, not a button — Agency, same as the other runners. */
export async function POST() {
  try {
    const result = await runRecoveryChecks();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
