import { NextRequest, NextResponse } from "next/server";
import { draftCustomPanel } from "@/lib/dashboard-chat";

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  try {
    const proposal = await draftCustomPanel(prompt.trim());
    return NextResponse.json({ proposal });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
