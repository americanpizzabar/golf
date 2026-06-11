import { del } from "@vercel/blob";
import { NextResponse } from "next/server";

// Deletes a relayed clip from Vercel Blob once the host has downloaded it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { url?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.url) return NextResponse.json({ error: "missing url" }, { status: 400 });
  try {
    await del(b.url);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/relay/delete]", e);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
