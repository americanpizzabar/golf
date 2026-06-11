import { NextResponse } from "next/server";
import * as q from "@/lib/server/queries";

// Single typed entry point for all client data access. The browser posts
// { action, deviceId, ... } and we dispatch to a whitelisted query. No raw SQL
// ever crosses the wire, and every write is scoped to the caller's device_id.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action: string;
  deviceId?: string;
  data?: Record<string, unknown>;
  limit?: number;
  id?: string;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const { action } = body;
  const dev = body.deviceId ?? "";
  const lim = typeof body.limit === "number" ? body.limit : undefined;

  // Actions that require a device id.
  const needsDevice =
    action !== "fetchPros";
  if (needsDevice && !dev) {
    return NextResponse.json({ error: "missing deviceId" }, { status: 400 });
  }

  try {
    switch (action) {
      case "fetchPros":
        return NextResponse.json({ data: await q.fetchPros() });
      case "getProfile":
        return NextResponse.json({ data: await q.getProfile(dev) });
      case "upsertProfile":
        return NextResponse.json({ data: await q.upsertProfile(dev, body.data ?? {}) });
      case "saveSwing":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ data: await q.saveSwing(dev, body.data as any) });
      case "fetchSwings":
        return NextResponse.json({ data: await q.fetchSwings(dev, lim) });
      case "saveApproach":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ data: await q.saveApproach(dev, body.data as any) });
      case "fetchApproaches":
        return NextResponse.json({ data: await q.fetchApproaches(dev, lim) });
      case "saveMenu":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ data: await q.saveMenu(dev, body.data as any) });
      case "fetchMenus":
        return NextResponse.json({ data: await q.fetchMenus(dev, lim) });
      case "saveBallShot":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ data: await q.saveBallShot(dev, body.data as any) });
      case "fetchBallShots":
        return NextResponse.json({ data: await q.fetchBallShots(dev, lim) });
      case "saveRound":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ data: await q.saveRound(dev, body.data as any) });
      case "fetchRounds":
        return NextResponse.json({ data: await q.fetchRounds(dev, lim) });
      case "saveCrossSession":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return NextResponse.json({ data: await q.saveCrossSession(dev, body.data as any) });
      case "fetchCrossSessions":
        return NextResponse.json({ data: await q.fetchCrossSessions(dev, lim) });
      case "deleteCrossSession":
        await q.deleteCrossSession(dev, body.id ?? "");
        return NextResponse.json({ data: null });
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error("[api/db]", action, e);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}
