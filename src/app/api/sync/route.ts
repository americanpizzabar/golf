import { NextResponse } from "next/server";
import { sql } from "@/lib/server/neon";

// Signaling + control relay for 2-device synchronized recording, replacing
// Supabase Realtime. Clients POST messages and poll via GET for messages newer
// than a sequence cursor. Rooms are identified by the 6-digit pairing code.
//
// This is a short-lived mailbox: each GET opportunistically sweeps rows older
// than 15 minutes so the table stays small without a cron job.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { code, sender, kind, payload }  -> append a message
export async function POST(req: Request) {
  let b: { code?: string; sender?: string; kind?: string; payload?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!b.code || !b.sender || !b.kind) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  try {
    const rows = (await sql`
      insert into sync_messages (code, sender, kind, payload)
      values (${b.code}, ${b.sender}, ${b.kind}, ${JSON.stringify(b.payload ?? {})}::jsonb)
      returning seq`) as { seq: number }[];
    return NextResponse.json({ seq: rows[0]?.seq ?? null });
  } catch (e) {
    console.error("[api/sync POST]", e);
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
}

// GET ?code=&after=&self=  -> messages with seq > after, from other peers
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const after = Number(url.searchParams.get("after") ?? "0") || 0;
  const self = url.searchParams.get("self") ?? "";
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  try {
    const rows = (await sql`
      select seq, sender, kind, payload from sync_messages
      where code = ${code} and seq > ${after} and sender <> ${self}
      order by seq asc limit 200`) as {
      seq: number;
      sender: string;
      kind: string;
      payload: unknown;
    }[];

    // Opportunistic cleanup of stale rooms (fire-and-forget).
    sql`delete from sync_messages where created_at < now() - interval '15 minutes'`.catch(
      () => {},
    );

    const last = rows.length ? rows[rows.length - 1].seq : after;
    return NextResponse.json({ messages: rows, last });
  } catch (e) {
    console.error("[api/sync GET]", e);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
