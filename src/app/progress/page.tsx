"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { PageHeader, Card, Stat } from "@/components/ui";
import { fetchSwings } from "@/lib/db";
import type { Swing } from "@/lib/types";

export default function ProgressPage() {
  const [swings, setSwings] = useState<Swing[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      setSwings(await fetchSwings(60));
      setLoaded(true);
    })();
  }, []);

  // chronological
  const chron = [...swings].reverse();
  const chart = chron.map((s, i) => ({
    i: i + 1,
    sync: s.sync_rate ?? 0,
    date: new Date(s.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }),
  }));

  const first = chron[0];
  const latest = chron[chron.length - 1];
  const delta = first && latest ? (latest.sync_rate ?? 0) - (first.sync_rate ?? 0) : 0;

  // 1-year projection: average gain per session * expected sessions, capped at 99
  const prediction = (() => {
    if (chron.length < 2 || !latest) return null;
    const span = chron.length - 1;
    const gainPerSession = ((latest.sync_rate ?? 0) - (first?.sync_rate ?? 0)) / span;
    // assume ~1 analysis / week → 52 more sessions, but damp the slope
    const projected = Math.min(99, Math.round((latest.sync_rate ?? 0) + gainPerSession * 26 * 0.6));
    return Math.max(latest.sync_rate ?? 0, projected);
  })();

  return (
    <main>
      <PageHeader title="成長ログ" subtitle="あなたの上達を記録・予測" back />
      <div className="px-4 space-y-4">
        {!loaded ? (
          <Card className="text-center py-8 text-sm" style={{ color: "var(--muted)" }}>
            読み込み中…
          </Card>
        ) : swings.length === 0 ? (
          <Card className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
            まだ記録がありません。<br />
            <Link href="/swing" style={{ color: "var(--green)" }}>スイング解析</Link>
            を保存すると成長が見えます。
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="最新シンクロ" value={latest?.sync_rate ?? "—"} unit="%" accent="var(--cyan)" />
              <Stat
                label="成長幅"
                value={`${delta >= 0 ? "+" : ""}${delta}`}
                unit="pt"
                accent={delta >= 0 ? "var(--green)" : "var(--red)"}
              />
              <Stat label="解析数" value={swings.length} accent="var(--amber)" />
            </div>

            {/* Sync trend */}
            <Card>
              <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                シンクロ率の推移
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chart} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fill: "#93a4bf", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#93a4bf", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#16233a", border: "1px solid #243651", borderRadius: 12, fontSize: 12 }}
                    formatter={(v) => [`${v}%`, "シンクロ率"]}
                  />
                  {prediction != null && (
                    <ReferenceLine y={prediction} stroke="#8b5cf6" strokeDasharray="4 4" label={{ value: `予測 ${prediction}%`, fill: "#8b5cf6", fontSize: 10, position: "insideTopRight" }} />
                  )}
                  <Line type="monotone" dataKey="sync" stroke="#22d3ee" strokeWidth={3} dot={{ r: 3, fill: "#22d3ee" }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            {/* 1-year prediction */}
            {prediction != null && (
              <Card className="relative overflow-hidden">
                <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-20" style={{ background: "#8b5cf6" }} />
                <div className="text-xs" style={{ color: "var(--muted)" }}>🔮 1年後の自分予測</div>
                <div className="mt-1 text-3xl font-extrabold" style={{ color: "#a78bfa" }}>
                  シンクロ率 {prediction}%
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  現在のペースで週1回の解析を続けた場合の予測値です。
                </p>
              </Card>
            )}

            {/* Before / After timelapse compare */}
            {first && latest && first.id !== latest.id && (
              <Card>
                <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
                  タイムラプス比較（最初 → 最新）
                </div>
                <div className="space-y-2">
                  <CompareRow label="シンクロ率" a={first.sync_rate} b={latest.sync_rate} unit="%" higherBetter />
                  <CompareRow label="肩の回転" a={first.shoulder_turn_deg} b={latest.shoulder_turn_deg} unit="°" higherBetter />
                  <CompareRow label="軸ブレ" a={swayOf(first)} b={swayOf(latest)} unit="cm" higherBetter={false} />
                  <CompareRow label="悪癖の数" a={first.faults?.length ?? 0} b={latest.faults?.length ?? 0} unit="件" higherBetter={false} />
                </div>
              </Card>
            )}

            {/* History list */}
            <Card>
              <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>履歴</div>
              <div className="space-y-2">
                {swings.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm">
                    <div className="w-12 text-center font-bold" style={{ color: "var(--cyan)" }}>
                      {s.sync_rate ?? "—"}%
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs" style={{ color: "var(--muted)" }}>
                        {new Date(s.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="truncate">
                        {s.faults?.length ? s.faults[0].label : "悪癖なし 👍"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

function swayOf(s: Swing): number {
  const f = s.faults?.find((x) => x.code === "sway");
  return f?.cm ?? 0;
}

function CompareRow({
  label,
  a,
  b,
  unit,
  higherBetter,
}: {
  label: string;
  a: number | null;
  b: number | null;
  unit: string;
  higherBetter: boolean;
}) {
  const av = a ?? 0;
  const bv = b ?? 0;
  const diff = bv - av;
  const improved = higherBetter ? diff > 0 : diff < 0;
  const same = diff === 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-20 text-xs" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="flex-1 flex items-center gap-2">
        <span style={{ color: "var(--muted)" }}>{av}{unit}</span>
        <span style={{ color: "var(--muted)" }}>→</span>
        <span className="font-bold">{bv}{unit}</span>
      </div>
      <span
        className="text-xs font-bold"
        style={{ color: same ? "var(--muted)" : improved ? "var(--green)" : "var(--red)" }}
      >
        {same ? "±0" : `${diff > 0 ? "+" : ""}${diff}${unit}`} {same ? "" : improved ? "↑" : "↓"}
      </span>
    </div>
  );
}
