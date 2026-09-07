"use client";

import { useState } from "react";

/**
 * 住民向け公開の切り替え
 *
 * 背景（claude/coe-tenant-isolation.md §11）: 公開ページは「その自治体で
 * 一番新しく作られた政策」を status も見ずに出していた。公開を明示的な操作にした
 * ので、その入口をここに置く。**既定は非公開。**
 */
export default function PublishToggle({
  projectId,
  initialPublishedAt,
  publicPath,
}: {
  projectId: string;
  initialPublishedAt: string | null;
  publicPath: string | null;
}) {
  const [publishedAt, setPublishedAt] = useState<string | null>(initialPublishedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const published = publishedAt != null;

  async function toggle(next: boolean) {
    // 公開は住民に見せる行為なので、公開する側だけ確認を挟む
    if (next && !window.confirm(
      "この政策を住民向けの公開ページに掲載します。\n" +
      "政策名・説明・KPI（目標値と現在値）・投稿が、ログイン不要で誰でも見られる状態になります。\n\n" +
      "よろしいですか？",
    )) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: next }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "切り替えに失敗しました");
        return;
      }
      setPublishedAt(json.data?.publishedAt ?? null);
    } catch {
      setError("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-2xl border p-5 space-y-3"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">住民向けの公開</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            公開すると、政策名・説明・KPI（目標値と現在値）・投稿が
            <strong className="text-slate-400">ログイン不要で誰でも</strong>見られます。
            既定は非公開です。
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => toggle(!published)}
          className="shrink-0 text-sm font-semibold px-4 py-2 rounded-xl transition-opacity disabled:opacity-50"
          style={{
            background: published ? "var(--bg-primary)" : "linear-gradient(135deg, #6366f1, #06b6d4)",
            color: published ? "#94a3b8" : "#fff",
            border: published ? "1px solid var(--border)" : "none",
          }}
        >
          {busy ? "処理中…" : published ? "公開を取り下げる" : "公開する"}
        </button>
      </div>

      <div className="text-xs">
        {published ? (
          <div className="text-emerald-300">
            公開中（{publishedAt}）
            {publicPath && (
              <>
                {" — "}
                <a href={publicPath} target="_blank" rel="noreferrer" className="underline">
                  公開ページを開く
                </a>
              </>
            )}
          </div>
        ) : (
          <div className="text-slate-500">非公開</div>
        )}
      </div>

      {published && (
        <p className="text-xs text-amber-300/80 leading-relaxed">
          ⚠ 公開ページのURLは自治体ごとに1つです。同じ自治体で複数の政策を公開した場合、
          最後に公開したものが表示されます。
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
