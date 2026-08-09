import { NextResponse } from "next/server";
import { generateRecommendations } from "@/lib/recommendations";

export async function POST() {
  try {
    const count = await generateRecommendations();
    return NextResponse.json({ count });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
