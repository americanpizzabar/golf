"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { fetchCrossSessions, deleteCrossSession } from "@/lib/db";
import type { CrossSession } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = { sync: "シンクロ撮影", cross: "動画読込" };

const SCORE_COLOR = (s: number) =>
  s >= 80 ? "var(--green)" : s >= 60 ? "var(--cyan)" : s >= 40 ? "var(--amber)" : "var(--red)";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

// History of saved two-camera analyses (sync + cross). Read-only list with an
// expandable detail view and per-row delete. Shared by /sync and /cross.
export function CrossHistory() {
  const [rows, setRows] = useState<CrossSession[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchCrossSessions(30)
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (rows === null || rows.length === 0) return null;

  const remove = async (id: string) => {
    setRows((r) => (r ? r.filter((x) => x.id !== id) : r));
    await deleteCrossSession(id).catch(() => {});
  };

  return (
    <Card>
      <div className="text-sm font-semibold mb-2">2視点解析の履歴</div>
      <div className="space-y-2">
        {rows.map((s) => {
          const score = s.score ?? 0;
          const isOpen = open === s.id;
          return (
            <div key={s.id} className="card p-0 overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : s.id)}
                className="w-full flex items-center gap-3 p-3 text-left active:scale-[0.99]"
              >
                <div
                  className="flex-none w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm"
                  style={{ background: SCORE_COLOR(score) + "22", color: SCORE_COLOR(score) }}
                >
                  {score}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                      style={{ background: "var(--bg-soft)", color: "var(--muted)" }}
                    >
                      {SOURCE_LABEL[s.source] ?? s.source}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                      {fmtDate(s.created_at)}
                    </span>
                  </div>
                  <div className="text-[13px] font-semibold truncate mt-0.5">
                    {s.top_finding ?? "解析結果"}
                  </div>
                </div>
                <span
                  className="flex-none text-[11px]"
                  style={{ color: "var(--muted)", transform: isOpen ? "rotate(180deg)" : "none" }}
                >
                  ▾
                </span>
              </button>

              {isOpen && (
                <div
                  className="px-3 pb-3 space-y-2 text-[12px] leading-relaxed"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <div className="pt-2 grid grid-cols-2 gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
                    <div>
                      正面 前傾Δ {fmtDelta(s.front_metrics.spineDelta)}° / 頭{" "}
                      {fmtSigned(s.front_metrics.headDropCm)}cm / 横ブレ {s.front_metrics.swayCm}cm
                    </div>
                    <div>
                      後方 前傾Δ {fmtDelta(s.dtl_metrics.spineDelta)}° / 腰前後{" "}
                      {s.dtl_metrics.hipMoveCm}cm
                    </div>
                  </div>
                  {s.findings.map((f, i) => (
                    <div key={i} className="card p-2.5">
                      <div className="font-semibold text-[12px] mb-1">{f.title}</div>
                      <div style={{ color: "var(--muted)" }}>
                        <div>正面：{f.front}</div>
                        <div>後方：{f.dtl}</div>
                        <div className="mt-1" style={{ color: "var(--text)" }}>
                          真因：{f.truth}
                        </div>
                        <div className="mt-1" style={{ color: "var(--green)" }}>
                          → {f.advice}
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => remove(s.id)}
                    className="text-[11px] mt-1"
                    style={{ color: "var(--red)" }}
                  >
                    この記録を削除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const fmtSigned = (n: number | undefined) => (n != null && n >= 0 ? "+" : "") + (n ?? 0);
const fmtDelta = (n: number | undefined) => (n != null && n >= 0 ? "+" : "") + (n ?? 0);
