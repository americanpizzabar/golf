"use client";

import { useEffect } from "react";

// Route-level error boundary. Converts any client-side exception into a friendly,
// recoverable screen (instead of the host webview's blank "page couldn't load"),
// and shows the actual message so problems can be diagnosed on-device.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error boundary:", error);
  }, [error]);

  return (
    <main className="min-h-screen grid place-items-center px-6" style={{ background: "var(--bg)" }}>
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-lg font-bold mb-1">問題が発生しました</h1>
        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
          画面の読み込み中にエラーが起きました。もう一度お試しください。
        </p>
        <div className="flex gap-2 justify-center">
          <button onClick={reset} className="btn btn-primary px-5 py-2.5">
            再試行
          </button>
          <button onClick={() => (window.location.href = "/")} className="btn btn-ghost px-5 py-2.5">
            ホームへ
          </button>
        </div>
        {error?.message && (
          <pre
            className="mt-4 text-[11px] text-left whitespace-pre-wrap break-words rounded-lg p-3"
            style={{ background: "var(--card)", color: "var(--muted)", border: "1px solid var(--line)" }}
          >
            {error.message}
          </pre>
        )}
      </div>
    </main>
  );
}
