"use client";

// Catches errors thrown in the root layout itself (where the route-level
// error.tsx cannot). Must render its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0b1220",
          color: "#e5e7eb",
          fontFamily: "system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, margin: "0 0 6px" }}>問題が発生しました</h1>
          <p style={{ fontSize: 13, color: "#93a4bf", margin: "0 0 16px" }}>
            もう一度お試しください。
          </p>
          <button
            onClick={reset}
            style={{
              background: "#22c55e",
              color: "#03260f",
              border: "none",
              borderRadius: 10,
              padding: "10px 20px",
              fontWeight: 700,
            }}
          >
            再試行
          </button>
          {error?.message && (
            <pre
              style={{
                marginTop: 16,
                fontSize: 11,
                textAlign: "left",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "#16233a",
                border: "1px solid #243651",
                borderRadius: 8,
                padding: 12,
              }}
            >
              {error.message}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
