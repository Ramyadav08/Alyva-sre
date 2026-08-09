import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/questions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (typeof body?.answer !== "string" || !body.answer.trim()) {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }
  const question = await answerQuestion(id, body.answer.trim());
  if (!question) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ question });
}
