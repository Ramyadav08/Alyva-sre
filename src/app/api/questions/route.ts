import { NextRequest, NextResponse } from "next/server";
import { listUnanswered } from "@/lib/questions";

export async function GET(req: NextRequest) {
  const skill = req.nextUrl.searchParams.get("skill") as "onboarding" | "alerting" | null;
  const questions = await listUnanswered(skill ?? undefined);
  return NextResponse.json({ questions });
}
