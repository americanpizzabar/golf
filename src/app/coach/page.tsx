"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Card } from "@/components/ui";
import { generateMenu, youtubeSearch, LIE_LABELS, LIE_ORDER } from "@/lib/golf";
import { fetchSwings, fetchApproaches, saveMenu } from "@/lib/db";
import type { Drill, Fault, LieType } from "@/lib/types";

export default function CoachPage() {
  const [minutes, setMinutes] = useState(60);
  const [balls, setBalls] = useState(100);
  const [mode, setMode] = useState<"range" | "home">("range");
  const [faults, setFaults] = useState<Fault[]>([]);
  const [weakLies, setWeakLies] = useState<LieType[]>([]);
  const [menu, setMenu] = useState<Drill[] | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [swings, approaches] = await Promise.all([fetchSwings(5), fetchApproaches(300)]);
      const latestFaults = swings[0]?.faults ?? [];
      setFaults(latestFaults);
      // weak lies = success rate < 50% with >=3 attempts
      const weak: LieType[] = [];
      for (const l of LIE_ORDER) {
        const s = approaches.filter((x) => x.lie_type === l);
        const att = s.reduce((a, x) => a + x.attempts, 0);
        const in1 = s.reduce((a, x) => a + x.in_1m, 0);
        if (att >= 3 && in1 / att < 0.5) weak.push(l);
      }
      setWeakLies(weak);
      setLoaded(true);
    })();
  }, []);

  function generate() {
    const { drills, focus } = generateMenu({
      availableMin: minutes,
      balls,
      mode,
      faults,
      weakLies,
    });
    setMenu(drills);
    setFocus(focus);
    setSaved(false);
  }

  async function save() {
    if (!menu) return;
    await saveMenu({
      available_min: minutes,
      balls: mode === "home" ? 0 : balls,
      mode,
      focus,
      drills: menu,
      completed: false,
    });
    setSaved(true);
  }

  const totalMin = menu?.reduce((s, d) => s + d.minutes, 0) ?? 0;
  const totalBalls = menu?.reduce((s, d) => s + (d.balls ?? 0), 0) ?? 0;

  return (
    <main>
      <PageHeader title="AIコーチ" subtitle="今日の最適メニューを処方" back />
      <div className="px-4 space-y-4">
        {/* Diagnosis summary */}
        <Card>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
            あなたの直近の課題
          </div>
          {!loaded ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>読み込み中…</p>
          ) : faults.length === 0 && weakLies.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              まだ診断データがありません。
              <Link href="/swing" style={{ color: "var(--green)" }}> スイング解析</Link>
              や
              <Link href="/approach" style={{ color: "var(--green)" }}> アプローチ計測</Link>
              を行うと精度が上がります。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {faults.map((f, i) => (
                <span key={i} className="text-[11px] px-2 py-1 rounded-full" style={{ background: "var(--bg-soft)", color: "var(--amber)" }}>
                  {f.label}
                </span>
              ))}
              {weakLies.map((l) => (
                <span key={l} className="text-[11px] px-2 py-1 rounded-full" style={{ background: "var(--bg-soft)", color: "var(--red)" }}>
                  {LIE_LABELS[l]}が苦手
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Time / balls / mode */}
        <Card className="space-y-4">
          <div>
            <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>練習モード</div>
            <div className="grid grid-cols-2 gap-2">
              {(["range", "home"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="btn py-2.5 text-sm"
                  style={{
                    background: mode === m ? "var(--green)" : "var(--bg-soft)",
                    color: mode === m ? "#03260f" : "var(--fg)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {m === "range" ? "🏌️ 練習場" : "🏠 自宅"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
              滞在時間（タイパ）: <b style={{ color: "var(--fg)" }}>{minutes}分</b>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[30, 60, 90, 120].map((m) => (
                <button
                  key={m}
                  onClick={() => setMinutes(m)}
                  className="btn py-2 text-sm"
                  style={{
                    background: minutes === m ? "var(--green)" : "var(--bg-soft)",
                    color: minutes === m ? "#03260f" : "var(--fg)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {m}分
                </button>
              ))}
            </div>
          </div>

          {mode === "range" && (
            <div>
              <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                球数: <b style={{ color: "var(--fg)" }}>{balls}球</b>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[50, 100, 150, 200].map((b) => (
                  <button
                    key={b}
                    onClick={() => setBalls(b)}
                    className="btn py-2 text-sm"
                    style={{
                      background: balls === b ? "var(--green)" : "var(--bg-soft)",
                      color: balls === b ? "#03260f" : "var(--fg)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {b}球
                  </button>
                ))}
              </div>
            </div>
          )}

          <button onClick={generate} className="btn btn-primary w-full py-3.5">
            ✨ メニューを生成
          </button>
        </Card>

        {/* Generated menu */}
        {menu && (
          <>
            <Card>
              <div className="flex items-center justify-between">
                <div className="font-bold">本日のメニュー</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  約{totalMin}分{mode === "range" ? ` / ${totalBalls}球` : ""}
                </div>
              </div>
            </Card>

            <div className="space-y-2">
              {menu.map((d, i) => (
                <Card key={i}>
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold shrink-0" style={{ background: "var(--green)33", color: "var(--green)" }}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{d.title}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                        {d.desc}
                      </div>
                      <div className="text-xs mt-1.5 inline-block px-2 py-0.5 rounded-full" style={{ background: "var(--bg-soft)", color: "var(--cyan)" }}>
                        💡 {d.cue}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: "var(--muted)" }}>
                        <span>⏱ {d.minutes}分</span>
                        {d.balls ? <span>🏐 {d.balls}球</span> : null}
                        <a
                          href={youtubeSearch(d.videoQuery)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto"
                          style={{ color: "var(--green)" }}
                        >
                          ▶ 処方箋動画
                        </a>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <button onClick={save} className="btn btn-primary w-full py-3.5">
              {saved ? "保存しました ✓" : "このメニューを保存"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
