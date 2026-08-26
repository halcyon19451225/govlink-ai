"use client";

/**
 * 「▶ 次期計画のたたき台を作成」ボタン＋作成モーダル — PL1 P①
 * 入口: プロジェクト設定画面・「📦 次期計画への引き継ぎ」タブ（設計どおり既存画面への追加のみ）
 *
 * 既定値: 標題=「◯◯（次期）」の自動提案・期間=前期と同じ長さで後ろへスライド。
 * 作成後は新計画のダッシュボードへ移動する（引き継ぎがあればバナーが出る — P②の入口）。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  projectId: string;
  sourceTitle?: string | null;
  planStart?: string | null; // YYYY-MM-DD
  planEnd?: string | null;
}

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

function slideDates(start?: string | null, end?: string | null): { start: string; end: string } {
  if (!start || !end) return { start: "", end: "" };
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { start: "", end: "" };
  const durationMs = e.getTime() - s.getTime();
  const newStart = new Date(e.getTime() + 86_400_000); // 前期終了の翌日
  const newEnd = new Date(newStart.getTime() + durationMs);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(newStart), end: fmt(newEnd) };
}

export default function CloneNextPeriodButton({ projectId, sourceTitle, planStart, planEnd }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const defaults = slideDates(planStart, planEnd);
  const [title, setTitle] = useState(sourceTitle ? `${sourceTitle}（次期）` : "");
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/clone-next-period`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          plan_start_date: start || null,
          plan_end_date: end || null,
        }),
      });
      const json = (await res.json()) as {
        data: { newProjectId: string; handoverLinked: boolean } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "複製に失敗しました");
        return;
      }
      router.push(`/projects/${json.data.newProjectId}`);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
        style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
      >
        ▶ 次期計画のたたき台を作成
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "#00000088" }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl p-5 space-y-3"
            style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              次期計画のたたき台を作成
            </h3>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              前期計画の枠（モジュール構成・チェックポイント・KPI定義・ロジックモデル・施策）を複製します。
              実績・評価・対話ログは持ち込みません。KPIの基準値は前期の最新実績になり、
              目標値は前期値のまま<b>「要見直し」</b>フラグが付きます。
            </p>
            <div className="space-y-2">
              <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
                新しい計画の標題（例: ◯◯計画（第n+1期））
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="◯◯計画（第n+1期）"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
                  計画開始日
                  <input type="date" className={inputClass} style={inputStyle} value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
                  計画終了日
                  <input type="date" className={inputClass} style={inputStyle} value={end} onChange={(e) => setEnd(e.target.value)} />
                </label>
              </div>
            </div>
            {error && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: "#ef444418", color: "#f87171" }}>
                ⚠ {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                キャンセル
              </button>
              <button
                onClick={() => void create()}
                disabled={busy || !title.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                style={{ background: "#6366f1" }}
              >
                {busy ? "作成中…" : "たたき台を作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
