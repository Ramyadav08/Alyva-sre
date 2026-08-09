import { NextResponse } from "next/server";
import { runPolicySweep } from "@/lib/alert-rules/policy-retune";

export async function POST() {
  const result = await runPolicySweep();
  return NextResponse.json(result);
}
