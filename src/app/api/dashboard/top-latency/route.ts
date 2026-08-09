import { NextResponse } from "next/server";
import { getServiceTrafficEdges } from "@/lib/lgtm";

export async function GET() {
  const edges = await getServiceTrafficEdges();
  return NextResponse.json({ edges });
}
