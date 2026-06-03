"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ja">
      <body style={{ background: "var(--bg-primary)", margin: 0, fontFamily: "sans-serif" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              padding: "40px",
              maxWidth: "400px",
              width: "100%",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <span style={{ fontSize: "48px", opacity: 0.6 }}>🚨</span>
            <div>
              <h2 style={{ color: "#f1f5f9", fontSize: "18px", fontWeight: 700, margin: "0 0 8px" }}>
                重大なエラーが発生しました
              </h2>
              <p style={{ color: "#94a3b8", fontSize: "14px", lineHeight: 1.6, margin: 0 }}>
                アプリケーションで予期しないエラーが発生しました。
              </p>
            </div>
            <button
              onClick={reset}
              style={{
                background: "linear-gradient(135deg, #6366f1, #06b6d4)",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                padding: "10px 24px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              再読み込み
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
