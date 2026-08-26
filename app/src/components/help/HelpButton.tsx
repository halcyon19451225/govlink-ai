"use client";

/**
 * 「❓ ヘルプ」ボタン＋ワイドドロワー（M1）
 * 各画面のヘッダに <HelpButton topicId="schedule" /> と置くだけで、
 * 作業中の画面を離れずにその画面のマニュアルを読める。
 * 「全画面で開く」→ /manual/<topicId>（印刷・リンク共有用）。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ManualView from "@/components/help/ManualView";

interface ManualPayload {
  id: string;
  title: string;
  updated: string;
  body: string;
  exists: boolean;
}

export default function HelpButton({ topicId }: { topicId: string }) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState<ManualPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/manual/${topicId}`);
      const json = (await res.json()) as { data: ManualPayload | null };
      setManual(json.data ?? null);
    } catch {
      setManual(null);
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  useEffect(() => {
    if (open && !manual && !loading) void load();
  }, [open, manual, loading, load]);

  // Escで閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="neu-button px-3 py-1.5 text-xs font-semibold"
        style={{ color: "var(--text-secondary)" }}
        title="この画面のマニュアルを開く"
      >
        ❓ ヘルプ
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          {/* 背景 */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setOpen(false)}
          />
          {/* 右ドロワー */}
          <div
            className="absolute right-0 top-0 bottom-0 overflow-y-auto p-6"
            style={{
              width: "min(720px, 92vw)",
              background: "var(--bg-primary)",
              borderLeft: "1px solid var(--border)",
              boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                {manual?.exists ? `📖 ${manual.title}` : "📖 マニュアル"}
              </h2>
              {manual?.updated && (
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  更新 {manual.updated}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                {manual?.exists && (
                  <Link
                    href={`/manual/${topicId}`}
                    target="_blank"
                    className="text-xs"
                    style={{ color: "#22d3ee" }}
                  >
                    ⧉ 全画面で開く
                  </Link>
                )}
                <Link href="/manual" target="_blank" className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  目次
                </Link>
                <button
                  onClick={() => setOpen(false)}
                  className="neu-button px-2 py-1 text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  ✕ 閉じる
                </button>
              </div>
            </div>

            {loading && (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                読み込み中…
              </p>
            )}
            {!loading && manual?.exists && <ManualView body={manual.body} />}
            {!loading && manual && !manual.exists && (
              <div
                className="rounded-xl p-4 text-sm"
                style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                この画面のマニュアルは<b>準備中</b>です。整備され次第ここに表示されます。
                <br />
                図の記法は <Link href="/manual/_conventions" target="_blank" style={{ color: "#22d3ee" }}>「図の読み方」</Link> をご覧ください。
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
