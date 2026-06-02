"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from "recharts";
import { PageHeader, Card, Stat } from "@/components/ui";
import { LIE_LABELS, LIE_ORDER } from "@/lib/golf";
import { fetchApproaches, saveApproach } from "@/lib/db";
import type { ApproachSession, LieType } from "@/lib/types";

export default function ApproachPage() {
  const [tab, setTab] = useState<"record" | "data">("record");
  const [sessions, setSessions] = useState<ApproachSession[]>([]);

  const reload = useCallback(async () => {
    setSessions(await fetchApproaches(300));
  }, []);
  useEffect(() => {
    (async () => setSessions(await fetchApproaches(300)))();
  }, []);

  return (
    <main>
      <PageHeader title="アプローチ計測" subtitle="ARターゲットで寄せ率をデータ化" back />

      <div className="px-4">
        <div className="flex gap-2 mb-4">
          {(["record", "data"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="btn flex-1 py-2.5 text-sm"
              style={{
                background: tab === t ? "var(--green)" : "var(--card)",
                color: tab === t ? "#03260f" : "var(--fg)",
                border: "1px solid var(--line)",
              }}
            >
              {t === "record" ? "🎯 計測する" : "📊 データを見る"}
            </button>
          ))}
        </div>

        {tab === "record" ? (
          <Recorder onSaved={() => { reload(); setTab("data"); }} />
        ) : (
          <DataView sessions={sessions} />
        )}
      </div>
    </main>
  );
}

function Recorder({ onSaved }: { onSaved: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [lie, setLie] = useState<LieType>("flat");
  const [distance, setDistance] = useState("20");
  const [tally, setTally] = useState({ attempts: 0, in_1m: 0, in_2m: 0, holed: 0 });

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function toggleCam() {
    if (camOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCamOn(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setCamOn(true);
    } catch {
      alert("カメラを起動できませんでした");
    }
  }

  function rec(kind: "holed" | "in1" | "in2" | "miss") {
    setTally((t) => ({
      attempts: t.attempts + 1,
      holed: t.holed + (kind === "holed" ? 1 : 0),
      in_1m: t.in_1m + (kind === "holed" || kind === "in1" ? 1 : 0),
      in_2m: t.in_2m + (kind !== "miss" ? 1 : 0),
    }));
    if (navigator.vibrate) navigator.vibrate(kind === "miss" ? 30 : 15);
  }

  async function save() {
    if (!tally.attempts) return;
    await saveApproach({
      lie_type: lie,
      distance_m: Number(distance) || null,
      attempts: tally.attempts,
      in_1m: tally.in_1m,
      in_2m: tally.in_2m,
      holed: tally.holed,
    });
    setTally({ attempts: 0, in_1m: 0, in_2m: 0, holed: 0 });
    onSaved();
  }

  const rate1 = tally.attempts ? Math.round((tally.in_1m / tally.attempts) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* AR target view */}
      <Card className="p-0 overflow-hidden">
        <div className="relative bg-[#0a2417] aspect-[4/3]">
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: camOn ? "block" : "none" }}
          />
          {/* AR concentric OK zones */}
          <svg viewBox="0 0 400 300" className="absolute inset-0 w-full h-full">
            <defs>
              <radialGradient id="grn" cx="50%" cy="60%">
                <stop offset="0%" stopColor="#0f5132" stopOpacity={camOn ? 0 : 0.9} />
                <stop offset="100%" stopColor="#06281a" stopOpacity={camOn ? 0 : 0.9} />
              </radialGradient>
            </defs>
            <rect width="400" height="300" fill="url(#grn)" />
            <ellipse cx="200" cy="175" rx="150" ry="70" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="8 5" opacity="0.9" />
            <text x="200" y="120" textAnchor="middle" fill="#f59e0b" fontSize="13" fontWeight="bold">半径2m</text>
            <ellipse cx="200" cy="175" rx="75" ry="35" fill="#22c55e22" stroke="#22c55e" strokeWidth="3" />
            <text x="200" y="178" textAnchor="middle" fill="#22c55e" fontSize="14" fontWeight="bold">OK 1m</text>
            <circle cx="200" cy="175" r="6" fill="#fff" />
            <line x1="200" y1="169" x2="200" y2="120" stroke="#fff" strokeWidth="2" />
            <circle cx="200" cy="116" r="5" fill="#ef4444" />
          </svg>
          <button
            onClick={toggleCam}
            className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5"
          >
            {camOn ? "カメラOFF" : "📷 グリーンに重ねる"}
          </button>
        </div>
      </Card>

      {/* Lie + distance */}
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>ライの状況</span>
            <select
              value={lie}
              onChange={(e) => setLie(e.target.value as LieType)}
              className="w-full px-3 py-2.5 mt-1"
            >
              {LIE_ORDER.map((l) => (
                <option key={l} value={l}>{LIE_LABELS[l]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>距離 (m)</span>
            <input
              type="number"
              inputMode="numeric"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="w-full px-3 py-2.5 mt-1"
            />
          </label>
        </div>
      </Card>

      {/* Tally */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="打数" value={tally.attempts} accent="var(--fg)" />
        <Stat label="1m以内" value={tally.in_1m} accent="var(--green)" />
        <Stat label="成功率" value={rate1} unit="%" accent="var(--cyan)" />
      </div>

      {/* Tap buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => rec("holed")} className="btn py-4 font-bold" style={{ background: "#fbbf24", color: "#3b2600" }}>
          🏆 カップイン
        </button>
        <button onClick={() => rec("in1")} className="btn btn-primary py-4">
          ⭕ 1m以内
        </button>
        <button onClick={() => rec("in2")} className="btn py-4" style={{ background: "#f59e0b33", color: "var(--amber)", border: "1px solid var(--line)" }}>
          🟠 2m以内
        </button>
        <button onClick={() => rec("miss")} className="btn btn-ghost py-4">
          ❌ 外す
        </button>
      </div>

      <button
        onClick={save}
        disabled={!tally.attempts}
        className="btn btn-primary w-full py-3.5 disabled:opacity-40"
      >
        このセッションを保存（{tally.attempts}球）
      </button>
    </div>
  );
}

function DataView({ sessions }: { sessions: ApproachSession[] }) {
  const byLie = LIE_ORDER.map((l) => {
    const s = sessions.filter((x) => x.lie_type === l);
    const att = s.reduce((a, x) => a + x.attempts, 0);
    const in1 = s.reduce((a, x) => a + x.in_1m, 0);
    return {
      lie: l,
      name: LIE_LABELS[l],
      attempts: att,
      rate: att ? Math.round((in1 / att) * 100) : 0,
    };
  }).filter((d) => d.attempts > 0);

  const totalAtt = sessions.reduce((a, x) => a + x.attempts, 0);
  const totalIn1 = sessions.reduce((a, x) => a + x.in_1m, 0);
  const totalHoled = sessions.reduce((a, x) => a + x.holed, 0);
  const overall = totalAtt ? Math.round((totalIn1 / totalAtt) * 100) : 0;
  const weakest = [...byLie].sort((a, b) => a.rate - b.rate)[0];

  const barColor = (rate: number) =>
    rate >= 60 ? "#22c55e" : rate >= 40 ? "#f59e0b" : "#ef4444";

  if (totalAtt === 0) {
    return (
      <Card className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
        まだデータがありません。<br />「計測する」から記録を始めましょう。
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="総打数" value={totalAtt} accent="var(--fg)" />
        <Stat label="1m成功率" value={overall} unit="%" accent="var(--green)" />
        <Stat label="カップイン" value={totalHoled} accent="#fbbf24" />
      </div>

      {weakest && weakest.rate < 50 && (
        <Card>
          <div className="text-sm">
            <span style={{ color: "var(--red)" }}>🔻 明確な弱点：</span>{" "}
            <b>{weakest.name}</b> の成功率は <b>{weakest.rate}%</b>。
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            AIコーチがこの状況のドリルを優先して提案します。
          </div>
        </Card>
      )}

      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          状況別 1m成功率
        </div>
        <ResponsiveContainer width="100%" height={Math.max(180, byLie.length * 44)}>
          <BarChart data={byLie} layout="vertical" margin={{ left: 10, right: 20 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={84}
              tick={{ fill: "#93a4bf", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "#ffffff10" }}
              contentStyle={{ background: "#16233a", border: "1px solid #243651", borderRadius: 12, fontSize: 12 }}
              formatter={(value, _name, item) => {
                const p = item as unknown as { payload: { attempts: number } };
                return [`${value}% (${p.payload.attempts}球)`, "成功率"];
              }}
            />
            <Bar dataKey="rate" radius={[0, 8, 8, 0]} label={{ position: "right", fill: "#eaf2ff", fontSize: 11, formatter: (v) => `${v}%` }}>
              {byLie.map((d, i) => (
                <Cell key={i} fill={barColor(d.rate)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>履歴</div>
        <div className="space-y-1.5">
          {sessions.slice(0, 12).map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{LIE_LABELS[s.lie_type]} · {s.distance_m ?? "—"}m</span>
              <span style={{ color: "var(--muted)" }}>
                {s.in_1m}/{s.attempts}（{s.attempts ? Math.round((s.in_1m / s.attempts) * 100) : 0}%）
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
