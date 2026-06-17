"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { saveRound, fetchRounds } from "@/lib/db";
import type { Round, RoundPlayer } from "@/lib/types";
import { useT } from "@/lib/i18n";

export default function MatchPage() {
  const t = useT();
  const [started, setStarted] = useState(false);
  const [course, setCourse] = useState("");
  const [holes, setHoles] = useState(9);
  const [players, setPlayers] = useState<RoundPlayer[]>([
    { name: t("あなた"), scores: [], approachIn: 0, approachAtt: 0 },
  ]);
  const [hole, setHole] = useState(1);
  const [history, setHistory] = useState<Round[]>([]);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    fetchRounds(10).then(setHistory);
  }, []);

  function addPlayer() {
    if (players.length >= 4) return;
    setPlayers([...players, { name: t("同伴者{n}", { n: players.length }), scores: [], approachIn: 0, approachAtt: 0 }]);
  }
  function setName(i: number, name: string) {
    setPlayers((p) => p.map((pl, j) => (j === i ? { ...pl, name } : pl)));
  }
  function setScore(i: number, h: number, val: number) {
    setPlayers((p) =>
      p.map((pl, j) => {
        if (j !== i) return pl;
        const scores = [...pl.scores];
        scores[h - 1] = Math.max(1, val);
        return { ...pl, scores };
      }),
    );
  }
  function bumpApproach(i: number, key: "approachIn" | "approachAtt", d: number) {
    setPlayers((p) =>
      p.map((pl, j) => {
        if (j !== i) return pl;
        const v = Math.max(0, pl[key] + d);
        const next = { ...pl, [key]: v };
        if (key === "approachAtt" && next.approachIn > v) next.approachIn = v;
        return next;
      }),
    );
  }

  const total = (pl: RoundPlayer) => pl.scores.reduce((s, x) => s + (x || 0), 0);
  const ranking = [...players].sort((a, b) => total(a) - total(b));

  async function finish() {
    await saveRound({ course_name: course || null, players, holes });
    setSavedMsg(true);
    setHistory(await fetchRounds(10));
    setTimeout(() => setSavedMsg(false), 2500);
    setStarted(false);
  }

  if (!started) {
    return (
      <main>
        <PageHeader title={t("一期一会ラウンド")} subtitle={t("同伴者とスコア・寄せ率を競う")} back />
        <div className="px-4 space-y-4">
          <Card className="space-y-3">
            <label className="block">
              <span className="text-xs" style={{ color: "var(--muted)" }}>{t("コース名（任意）")}</span>
              <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder={t("○○カントリークラブ")} className="w-full px-3 py-2.5 mt-1" />
            </label>
            <div>
              <span className="text-xs" style={{ color: "var(--muted)" }}>{t("ホール数")}</span>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {[9, 18].map((h) => (
                  <button key={h} onClick={() => setHoles(h)} className="btn py-2.5 text-sm"
                    style={{ background: holes === h ? "var(--green)" : "var(--bg-soft)", color: holes === h ? "#03260f" : "var(--fg)", border: "1px solid var(--line)" }}>
                    {t("{h}ホール", { h })}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs" style={{ color: "var(--muted)" }}>{t("プレーヤー（最大4人）")}</span>
              <div className="space-y-2 mt-1">
                {players.map((pl, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={pl.name} onChange={(e) => setName(i, e.target.value)} className="flex-1 px-3 py-2" />
                    {i > 0 && (
                      <button onClick={() => setPlayers(players.filter((_, j) => j !== i))} className="btn btn-ghost px-3">✕</button>
                    )}
                  </div>
                ))}
                {players.length < 4 && (
                  <button onClick={addPlayer} className="btn btn-ghost w-full py-2 text-sm">{t("＋ 同伴者を追加")}</button>
                )}
              </div>
            </div>
          </Card>
          <button onClick={() => { setStarted(true); setHole(1); }} className="btn btn-primary w-full py-3.5">
            {t("⛳ ラウンド開始")}
          </button>

          {savedMsg && <p className="text-center text-sm" style={{ color: "var(--green)" }}>{t("ラウンドを保存しました ✓")}</p>}

          {history.length > 0 && (
            <Card>
              <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{t("過去のラウンド")}</div>
              <div className="space-y-1.5 text-sm">
                {history.map((r) => {
                  const win = [...r.players].sort((a, b) => a.scores.reduce((s, x) => s + (x || 0), 0) - b.scores.reduce((s, x) => s + (x || 0), 0))[0];
                  return (
                    <div key={r.id} className="flex justify-between">
                      <span>{r.course_name || t("ラウンド")} · {r.holes}H</span>
                      <span style={{ color: "var(--muted)" }}>🏆 {win?.name}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </main>
    );
  }

  return (
    <main>
      <PageHeader title={course || t("ラウンド中")} subtitle={t("{holes}ホール", { holes })} back />
      <div className="px-4 space-y-4">
        {/* Hole selector */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {Array.from({ length: holes }, (_, i) => i + 1).map((h) => (
            <button key={h} onClick={() => setHole(h)} className="btn shrink-0 w-10 h-10 text-sm"
              style={{ background: hole === h ? "var(--green)" : "var(--card)", color: hole === h ? "#03260f" : "var(--fg)", border: "1px solid var(--line)" }}>
              {h}
            </button>
          ))}
        </div>

        <Card>
          <div className="text-sm font-bold mb-3">{t("🕳 {hole}番ホール スコア入力", { hole })}</div>
          <div className="space-y-3">
            {players.map((pl, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-1 min-w-0 truncate text-sm font-semibold">{pl.name}</div>
                <button onClick={() => setScore(i, hole, (pl.scores[hole - 1] || 4) - 1)} className="btn btn-ghost w-9 h-9">−</button>
                <div className="w-8 text-center font-bold text-lg">{pl.scores[hole - 1] || "-"}</div>
                <button onClick={() => setScore(i, hole, (pl.scores[hole - 1] || 4) + 1)} className="btn btn-ghost w-9 h-9">＋</button>
              </div>
            ))}
          </div>
        </Card>

        {/* Approach mini-game */}
        <Card>
          <div className="text-sm font-bold mb-3">{t("🎯 寄せ成功率（ラウンド通算）")}</div>
          <div className="space-y-2">
            {players.map((pl, i) => {
              const rate = pl.approachAtt ? Math.round((pl.approachIn / pl.approachAtt) * 100) : 0;
              return (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <div className="flex-1 min-w-0 truncate">{pl.name}</div>
                  <button onClick={() => bumpApproach(i, "approachAtt", 1)} className="btn btn-ghost px-2 py-1 text-xs">{t("打数+")}</button>
                  <button onClick={() => bumpApproach(i, "approachIn", 1)} className="btn btn-primary px-2 py-1 text-xs">{t("寄った+")}</button>
                  <div className="w-20 text-right" style={{ color: "var(--cyan)" }}>{t("{i}/{a}（{rate}%）", { i: pl.approachIn, a: pl.approachAtt, rate })}</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Leaderboard */}
        <Card>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{t("リーダーボード")}</div>
          <div className="space-y-2">
            {ranking.map((pl, i) => (
              <div key={pl.name} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full grid place-items-center text-xs font-bold" style={{ background: i === 0 ? "#fbbf2433" : "var(--bg-soft)", color: i === 0 ? "#fbbf24" : "var(--muted)" }}>
                  {i + 1}
                </div>
                <div className="flex-1 truncate text-sm">{pl.name}</div>
                <div className="font-bold">{total(pl) || 0}</div>
                <div className="text-xs w-12 text-right" style={{ color: "var(--muted)" }}>
                  {pl.scores.filter(Boolean).length}/{holes}H
                </div>
              </div>
            ))}
          </div>
        </Card>

        <button onClick={finish} className="btn btn-primary w-full py-3.5">{t("ラウンドを終了して保存")}</button>
      </div>
    </main>
  );
}
