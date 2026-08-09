import { NextResponse } from "next/server";
import { listPolicies, createPolicy } from "@/lib/alert-policies";

export async function GET() {
  const policies = await listPolicies();
  return NextResponse.json({ policies });
}

export async function POST(req: Request) {
  const body = await req.json();
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const policy = await createPolicy(text);
  return NextResponse.json({ policy }, { status: 201 });
}
