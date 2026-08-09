import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";

export async function GET() {
  const db = await getDb();
  const postmortems = [...(db.data.postmortems ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return NextResponse.json({ postmortems });
}
