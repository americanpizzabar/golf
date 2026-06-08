"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, Card, Spinner } from "@/components/ui";
import { getPoseLandmarker } from "@/lib/pose";
import { getProfile } from "@/lib/db";
import { extractClip, type Clip } from "@/lib/clip";
import { crossAnalyze, type CrossResult } from "@/lib/cross-angle";
import { TwinPlayer, CrossReport, SyncBadge } from "@/components/CrossPlayer";
import { SyncSession, type SyncState } from "@/lib/sync-session";

type Mode = "choose" | "host" | "guest";
type Stage = "live" | "analyzing" | "result";
type Angle = "front" | "dtl";

const ANGLE_LABEL: Record<Angle, string> = { front: "正面", dtl: "後方(DTL)" };

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const cands = [
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of cands) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export default function SyncPage() {
  const [mode, setMode] = useState<Mode>("choose");
  const [stage, setStage] = useState<Stage>("live");
  const [code, setCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [conn, setConn] = useState<SyncState>("signaling");
  const [hostRole, setHostRole] = useState<Angle>("front"); // host's own angle
  const [guestRole, setGuestRole] = useState<Angle>("dtl"); // shown on the guest
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [status, setStatus] = useState("");
  const [recvPct, setRecvPct] = useState(0); // host: receiving child clip
  const [sendPct, setSendPct] = useState(0); // guest: sending its clip
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState("");
  const [clips, setClips] = useState<{ front?: Clip; dtl?: Clip }>({});
  const [result, setResult] = useState<CrossResult | null>(null);
  const [leftHanded, setLeftHanded] = useState(false);
  const [err, setErr] = useState("");

  const previewRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<SyncSession | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const localBlobRef = useRef<Blob | null>(null); // this device's recording
  const remoteBlobRef = useRef<Blob | null>(null); // peer's recording (host only)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hostRoleRef = useRef(hostRole);
  const leftRef = useRef(false);
  const heightRef = useRef(170);
  const clipsRef = useRef(clips);
  useEffect(() => {
    hostRoleRef.current = hostRole;
  }, [hostRole]);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(() => {
    (async () => {
      const p = await getProfile();
      const lh = p?.dominant_hand === "left";
      leftRef.current = lh;
      setLeftHanded(lh);
      if (p?.height_cm) heightRef.current = p.height_cm;
    })();
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    sessionRef.current?.close();
    sessionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const c = clipsRef.current;
    if (c.front) URL.revokeObjectURL(c.front.url);
    if (c.dtl) URL.revokeObjectURL(c.dtl.url);
  }, []);
  useEffect(() => () => cleanup(), [cleanup]);

  async function startCamera(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: true, // audio is required for the impact-sound sync
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.muted = true;
        await previewRef.current.play().catch(() => {});
      }
      return true;
    } catch {
      setErr("カメラ/マイクを利用できませんでした。ブラウザの権限を許可してください。");
      return false;
    }
  }

  // --- Recording -----------------------------------------------------------
  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    localBlobRef.current = null;
    const mime = pickMime();
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      setErr("この端末では録画(MediaRecorder)に対応していません。");
      return;
    }
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime || "video/webm" });
      localBlobRef.current = blob;
      onLocalRecordingDone(blob);
    };
    recorderRef.current = mr;
    mr.start();
    setRecording(true);
    setRecSec(0);
    timerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    try {
      recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
  }

  function onLocalRecordingDone(blob: Blob) {
    if (mode === "guest") {
      // Send the clip to the host over the data channel.
      setStatus("親機へ送信中…");
      sessionRef.current?.sendClip("child", blob).then(() => setStatus("送信完了 ✓"));
    } else {
      // Host: maybe both clips are ready now.
      setStatus(remoteBlobRef.current ? "両動画そろいました" : "子機の録画/送信を待っています…");
      maybeAnalyze();
    }
  }

  // --- Host control --------------------------------------------------------
  function hostStartRecord() {
    sessionRef.current?.send({ t: "start" });
    startRecording();
    setStatus("録画中（親機・子機 同時）");
  }
  function hostStopRecord() {
    sessionRef.current?.send({ t: "stop" });
    stopRecording();
  }

  const maybeAnalyze = useCallback(async () => {
    if (stage !== "live") return;
    const local = localBlobRef.current;
    const remote = remoteBlobRef.current;
    if (!local || !remote) return;
    setStage("analyzing");
    try {
      const model = await getPoseLandmarker();
      const hr = hostRoleRef.current;
      const frontBlob = hr === "front" ? local : remote;
      const dtlBlob = hr === "front" ? remote : local;
      setPhase("正面動画を解析中…");
      setPct(0);
      const front = await extractClip(frontBlob, model, leftRef.current, setPct);
      setPhase("後方動画を解析中…");
      setPct(0);
      const dtl = await extractClip(dtlBlob, model, leftRef.current, setPct);
      if (front.frames.length < 5 || dtl.frames.length < 5) {
        setErr("骨格を十分に検出できませんでした。全身が大きく・明るく映るよう撮り直してください。");
        URL.revokeObjectURL(front.url);
        URL.revokeObjectURL(dtl.url);
        setStage("live");
        return;
      }
      setClips({ front, dtl });
      setResult(crossAnalyze(front.flat, dtl.flat, { leftHanded: leftRef.current, heightCm: heightRef.current }));
      setStage("result");
    } catch (e) {
      console.error(e);
      setErr("解析中にエラーが発生しました。");
      setStage("live");
    }
  }, [stage]);

  // --- Session handlers ----------------------------------------------------
  const buildHandlers = useCallback(
    (role: Mode) => ({
      onState: (s: SyncState) => {
        setConn(s);
        if (s === "connected" && role === "host") {
          // Tell the guest which angle it should film (the opposite of host).
          const gr: Angle = hostRoleRef.current === "front" ? "dtl" : "front";
          setGuestRole(gr);
          sessionRef.current?.send({ t: "role", role: gr });
          setStatus("接続しました。録画ボタンで2台同時に撮影します。");
        }
        if (s === "connected" && role === "guest") setStatus("接続しました。親機の操作を待っています…");
        if (s === "failed")
          setErr("端末間の直接接続に失敗しました。両端末を同じWi-Fiに繋いで再度お試しください。");
      },
      onMessage: (msg: Record<string, unknown>) => {
        if (msg.t === "role" && (msg.role === "front" || msg.role === "dtl")) {
          setGuestRole(msg.role);
        } else if (msg.t === "start") {
          startRecording();
          setStatus("録画中…");
        } else if (msg.t === "stop") {
          stopRecording();
        }
      },
      onClipProgress: (kind: string, p: number) => {
        if (kind !== "child") return;
        // Same channel reports sending (guest) and receiving (host) progress.
        if (role === "guest") setSendPct(p);
        else setRecvPct(p);
      },
      onClip: (kind: string, blob: Blob) => {
        if (kind === "child") {
          remoteBlobRef.current = blob;
          setRecvPct(1);
          setStatus("子機の動画を受信しました");
          maybeAnalyze();
        }
      },
    }),
    // startRecording/stopRecording read only refs + state setters; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maybeAnalyze],
  );

  async function createSession() {
    setErr("");
    const c = String(Math.floor(100000 + Math.random() * 900000));
    setCode(c);
    setMode("host");
    setConn("signaling");
    const ok = await startCamera();
    if (!ok) return;
    const s = new SyncSession(c, "host", buildHandlers("host"));
    sessionRef.current = s;
    await s.start();
    setStatus("子機の参加を待っています…");
  }

  async function joinSession() {
    setErr("");
    if (!/^\d{6}$/.test(joinCode)) {
      setErr("6桁のコードを入力してください。");
      return;
    }
    setMode("guest");
    setConn("signaling");
    const ok = await startCamera();
    if (!ok) return;
    const s = new SyncSession(joinCode, "guest", buildHandlers("guest"));
    sessionRef.current = s;
    await s.start();
    setStatus("親機に接続しています…");
  }

  function restart() {
    const c = clipsRef.current;
    if (c.front) URL.revokeObjectURL(c.front.url);
    if (c.dtl) URL.revokeObjectURL(c.dtl.url);
    localBlobRef.current = null;
    remoteBlobRef.current = null;
    setClips({});
    setResult(null);
    setRecvPct(0);
    setSendPct(0);
    setErr("");
    setStage("live");
    setStatus(mode === "host" ? "もう一度、録画ボタンで撮影できます。" : "親機の操作を待っています…");
  }

  function leave() {
    cleanup();
    setMode("choose");
    setStage("live");
    setCode("");
    setJoinCode("");
    setConn("signaling");
    setClips({});
    setResult(null);
    setStatus("");
    setErr("");
    localBlobRef.current = null;
    remoteBlobRef.current = null;
  }

  const connected = conn === "connected";

  return (
    <main>
      <PageHeader
        title="シンクロ撮影"
        subtitle="2台のスマホを6桁コードで繋ぎ、正面×後方を同時録画"
        back
      />
      <div className="px-4 space-y-4 pb-8">
        {err && (
          <Card className="py-3">
            <div className="text-xs" style={{ color: "var(--red)" }}>
              {err}
            </div>
          </Card>
        )}

        {/* --- Choose role --- */}
        {mode === "choose" && (
          <>
            <Card className="space-y-3">
              <div className="text-sm font-semibold">2台で同時に撮影する</div>
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                片方を「親機」にして6桁コードを発行し、もう片方の「子機」で入力します。親機の録画ボタンで
                両方が同時に録画され、子機の映像は端末間で直接送られて自動解析されます（クラウド保存なし）。
              </p>
              <button
                onClick={createSession}
                className="btn w-full py-2.5 text-sm font-bold"
                style={{ background: "var(--green)", color: "#03260f" }}
              >
                親機にする（コードを発行）
              </button>
            </Card>
            <Card className="space-y-2">
              <div className="text-sm font-semibold">子機として参加</div>
              <input
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6桁コード"
                className="w-full px-3 py-2.5 text-center text-lg tracking-[0.3em] font-bold"
              />
              <button
                onClick={joinSession}
                disabled={joinCode.length !== 6}
                className="btn w-full py-2.5 text-sm font-bold"
                style={{
                  background: joinCode.length === 6 ? "var(--cyan)" : "var(--bg-soft)",
                  color: joinCode.length === 6 ? "#04121f" : "var(--muted)",
                }}
              >
                参加する
              </button>
            </Card>
            <Card>
              <div className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                💡 両端末を<strong>同じWi-Fi</strong>に繋ぐと接続が安定します。三脚やもう1台のスマホを
                正面・後方に設置し、インパクトの打音がどちらにも入るようにすると同期精度が上がります。
              </div>
            </Card>
          </>
        )}

        {/* --- Host / Guest live session --- */}
        {mode !== "choose" && stage === "live" && (
          <>
            <Card className="py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span style={{ color: "var(--muted)" }}>
                    {mode === "host" ? "親機" : "子機"}・
                  </span>
                  <span
                    className="font-bold"
                    style={{ color: connected ? "var(--green)" : "var(--amber)" }}
                  >
                    {connected ? "接続済み" : conn === "failed" ? "未接続" : "接続待ち…"}
                  </span>
                </div>
                {mode === "host" && (
                  <div className="text-right">
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                      接続コード
                    </div>
                    <div className="text-2xl font-bold tracking-[0.25em]" style={{ color: "var(--cyan)" }}>
                      {code}
                    </div>
                  </div>
                )}
              </div>
              {status && (
                <div className="text-[12px] mt-1.5" style={{ color: "var(--muted)" }}>
                  {status}
                </div>
              )}
            </Card>

            {/* Camera preview */}
            <div
              className="relative rounded-xl overflow-hidden mx-auto w-full"
              style={{ background: "#0b1220", border: "1px solid var(--line)", aspectRatio: "3/4", maxWidth: 360 }}
            >
              <video
                ref={previewRef}
                muted
                playsInline
                autoPlay
                className="absolute inset-0 w-full h-full object-cover"
              />
              <span
                className="absolute top-2 left-2 px-2 py-0.5 rounded text-[11px] font-bold"
                style={{ background: "var(--green)", color: "#03260f" }}
              >
                あなた＝{ANGLE_LABEL[mode === "host" ? hostRole : guestRole]}
              </span>
              {recording && (
                <span className="absolute top-2 right-2 px-2 py-0.5 rounded text-[11px] font-bold flex items-center gap-1" style={{ background: "var(--red)", color: "#fff" }}>
                  ● REC {recSec}s
                </span>
              )}
            </div>

            {/* Host controls */}
            {mode === "host" && (
              <Card className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    あなた（親機）のアングル
                  </span>
                  <div className="flex gap-1">
                    {(["front", "dtl"] as Angle[]).map((a) => (
                      <button
                        key={a}
                        disabled={recording}
                        onClick={() => {
                          setHostRole(a);
                          const gr: Angle = a === "front" ? "dtl" : "front";
                          setGuestRole(gr);
                          sessionRef.current?.send({ t: "role", role: gr });
                        }}
                        className="px-2.5 py-1 rounded text-xs"
                        style={{
                          background: hostRole === a ? "var(--green)" : "var(--bg-soft)",
                          color: hostRole === a ? "#03260f" : "var(--muted)",
                        }}
                      >
                        {ANGLE_LABEL[a]}
                      </button>
                    ))}
                  </div>
                </div>
                {!recording ? (
                  <button
                    onClick={hostStartRecord}
                    disabled={!connected}
                    className="btn w-full py-3 text-sm font-bold"
                    style={{
                      background: connected ? "var(--red)" : "var(--bg-soft)",
                      color: connected ? "#fff" : "var(--muted)",
                    }}
                  >
                    ● 2台同時に録画開始
                  </button>
                ) : (
                  <button
                    onClick={hostStopRecord}
                    className="btn w-full py-3 text-sm font-bold"
                    style={{ background: "var(--fg)", color: "var(--bg)" }}
                  >
                    ■ 停止して解析
                  </button>
                )}
                {recvPct > 0 && recvPct < 1 && (
                  <div>
                    <div className="text-[11px] mb-1" style={{ color: "var(--muted)" }}>
                      子機から受信中… {Math.round(recvPct * 100)}%
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-soft)" }}>
                      <div className="h-full" style={{ width: `${recvPct * 100}%`, background: "var(--cyan)" }} />
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Guest status */}
            {mode === "guest" && (
              <Card className="space-y-2">
                <div className="text-sm">
                  あなたの担当：
                  <span className="font-bold ml-1" style={{ color: "var(--cyan)" }}>
                    {ANGLE_LABEL[guestRole]}
                  </span>
                </div>
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  録画は親機の操作で自動的に始まります。スマホを固定し、全身が画面に大きく入るよう構えてください。
                </p>
                {sendPct > 0 && sendPct < 1 && (
                  <div>
                    <div className="text-[11px] mb-1" style={{ color: "var(--muted)" }}>
                      親機へ送信中… {Math.round(sendPct * 100)}%
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-soft)" }}>
                      <div className="h-full" style={{ width: `${sendPct * 100}%`, background: "var(--green)" }} />
                    </div>
                  </div>
                )}
              </Card>
            )}

            <button onClick={leave} className="btn btn-ghost w-full py-2 text-xs">
              セッションを終了
            </button>
          </>
        )}

        {/* --- Analyzing (host) --- */}
        {stage === "analyzing" && (
          <Card className="text-center py-8 space-y-3">
            <Spinner label={phase || "解析中…"} />
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-soft)" }}>
              <div className="h-full transition-all" style={{ width: `${pct}%`, background: "var(--green)" }} />
            </div>
          </Card>
        )}

        {/* --- Result (host) --- */}
        {stage === "result" && clips.front && clips.dtl && result && (
          <>
            <SyncBadge front={clips.front} dtl={clips.dtl} />
            <TwinPlayer front={clips.front} dtl={clips.dtl} leftHanded={leftHanded} />
            <CrossReport result={result} />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={restart} className="btn btn-ghost py-2.5 text-sm">
                もう一度撮影
              </button>
              <button onClick={leave} className="btn btn-ghost py-2.5 text-sm">
                終了
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
