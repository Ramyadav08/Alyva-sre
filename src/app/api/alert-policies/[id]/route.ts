import { NextResponse } from "next/server";
import { setPolicyActive } from "@/lib/alert-policies";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (typeof body?.active !== "boolean") {
    return NextResponse.json({ error: "active (boolean) is required" }, { status: 400 });
  }
  const policy = await setPolicyActive(id, body.active);
  if (!policy) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ policy });
}
