"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader, Card, Spinner } from "@/components/ui";
import { getPoseLandmarker } from "@/lib/pose";
import { getProfile, saveCrossSession } from "@/lib/db";
import { extractClip, type Clip } from "@/lib/clip";
import { crossAnalyze, type CrossResult } from "@/lib/cross-angle";
import { TwinPlayer, CrossReport, SyncBadge } from "@/components/CrossPlayer";
import { CrossHistory } from "@/components/CrossHistory";

type Slot = "front" | "dtl";
type Stage = "idle" | "processing" | "ready";

const SLOT_LABEL: Record<Slot, string> = { front: "正面", dtl: "後方(DTL)" };

export default function CrossPage() {
  const [files, setFiles] = useState<{ front?: File; dtl?: File }>({});
  const [clips, setClips] = useState<{ front?: Clip; dtl?: Clip }>({});
  const [stage, setStage] = useState<Stage>("idle");
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<CrossResult | null>(null);
  const [leftHanded, setLeftHanded] = useState(false);
  const [heightCm, setHeightCm] = useState<number>(170);

  useEffect(() => {
    (async () => {
      const p = await getProfile();
      setLeftHanded(p?.dominant_hand === "left");
      if (p?.height_cm) setHeightCm(p.height_cm);
    })();
  }, []);

  // Revoke object URLs on unmount / reset.
  const clipsRef = useRef(clips);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  useEffect(() => {
    return () => {
      const c = clipsRef.current;
      if (c.front) URL.revokeObjectURL(c.front.url);
      if (c.dtl) URL.revokeObjectURL(c.dtl.url);
    };
  }, []);

  const onPick = (slot: Slot) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr("");
    setFiles((prev) => ({ ...prev, [slot]: f }));
  };

  const run = async () => {
    if (!files.front || !files.dtl) return;
    setErr("");
    setStage("processing");
    setResult(null);
    try {
      const model = await getPoseLandmarker();
      setPhase("正面動画を解析中…（打音を検出しています）");
      setPct(0);
      const front = await extractClip(files.front, model, leftHanded, setPct);
      setPhase("後方動画を解析中…（骨格を抽出しています）");
      setPct(0);
      const dtl = await extractClip(files.dtl, model, leftHanded, setPct);

      if (front.frames.length < 5 || dtl.frames.length < 5) {
        setErr(
          "どちらかの動画で骨格を十分に検出できませんでした。全身が大きく・明るく映った動画でお試しください。",
        );
        URL.revokeObjectURL(front.url);
        URL.revokeObjectURL(dtl.url);
        setStage("idle");
        return;
      }

      setClips({ front, dtl });
      const res = crossAnalyze(front.flat, dtl.flat, { leftHanded, heightCm });
      setResult(res);
      saveCrossSession(res, { source: "cross", leftHanded, heightCm }).catch(() => {});
      setStage("ready");
    } catch (e) {
      console.error(e);
      setErr("解析中にエラーが発生しました。動画ファイルを変えてお試しください。");
      setStage("idle");
    }
  };

  const reset = () => {
    if (clips.front) URL.revokeObjectURL(clips.front.url);
    if (clips.dtl) URL.revokeObjectURL(clips.dtl.url);
    setClips({});
    setFiles({});
    setResult(null);
    setErr("");
    setStage("idle");
  };

  return (
    <main>
      <PageHeader
        title="クロスアングル解析"
        subtitle="正面×後方を打音で完全同期・2視点で真因を判定"
        back
      />
      <div className="px-4 space-y-4 pb-8">
        {stage === "idle" && (
          <>
            <Card>
              <div className="text-sm font-semibold mb-1">2つの視点の動画を読み込み</div>
              <p className="text-[12px] mb-3" style={{ color: "var(--muted)" }}>
                同じスイングを「正面」と「後方(DTL)」から撮った2本を選んでください。打球音(打音)の
                波形を照合して、2本を1コマのズレもなく自動同期します。
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(["front", "dtl"] as Slot[]).map((slot) => (
                  <label
                    key={slot}
                    className="card p-3 flex flex-col items-center justify-center text-center cursor-pointer active:scale-[0.99]"
                    style={{ borderStyle: files[slot] ? "solid" : "dashed", minHeight: 96 }}
                  >
                    <span className="text-2xl">{slot === "front" ? "🧍" : "🏌️"}</span>
                    <span className="text-xs font-semibold mt-1">{SLOT_LABEL[slot]}</span>
                    <span
                      className="text-[11px] mt-0.5 truncate max-w-full"
                      style={{ color: files[slot] ? "var(--green)" : "var(--muted)" }}
                    >
                      {files[slot] ? "✓ 選択済み" : "タップして選択"}
                    </span>
                    <input type="file" accept="video/*" className="hidden" onChange={onPick(slot)} />
                  </label>
                ))}
              </div>
              <button
                onClick={run}
                disabled={!files.front || !files.dtl}
                className="btn w-full mt-3 py-2.5 text-sm font-bold"
                style={{
                  background: files.front && files.dtl ? "var(--green)" : "var(--bg-soft)",
                  color: files.front && files.dtl ? "#03260f" : "var(--muted)",
                }}
              >
                同期して解析する
              </button>
              {err && (
                <div className="text-xs mt-2" style={{ color: "var(--red)" }}>
                  {err}
                </div>
              )}
            </Card>
            <Card>
              <div className="text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                💡 同期のコツ：両方の動画に「インパクトの打音」がはっきり入っていると精度が上がります。
                音声が無い動画でも、骨格から推定した最速点(インパクト)で自動同期します。
                2台同時撮影には{" "}
                <a href="/sync" style={{ color: "var(--green)" }}>
                  シンクロ撮影
                </a>{" "}
                が便利です。解析はすべて端末内(MediaPipe)で行われます。
              </div>
            </Card>
            <CrossHistory />
          </>
        )}

        {stage === "processing" && (
          <Card className="text-center py-8 space-y-3">
            <Spinner label={phase} />
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-soft)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: "var(--green)" }}
              />
            </div>
          </Card>
        )}

        {stage === "ready" && clips.front && clips.dtl && result && (
          <>
            <SyncBadge front={clips.front} dtl={clips.dtl} />
            <TwinPlayer front={clips.front} dtl={clips.dtl} leftHanded={leftHanded} />
            <CrossReport result={result} />
            <button onClick={reset} className="btn btn-ghost w-full py-2.5 text-sm">
              別の動画で解析する
            </button>
          </>
        )}
      </div>
    </main>
  );
}
