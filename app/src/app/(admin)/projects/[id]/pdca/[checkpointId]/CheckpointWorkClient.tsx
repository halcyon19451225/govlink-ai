"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PdcaCheckpoint } from "../page";

const PHASE_COLORS: Record<string, string> = {
  P:     "#6366f1",
  D:     "#06b6d4",
  C:     "#f59e0b",
  A:     "#10b981",
  "P-D": "#8b5cf6",
  "C-A": "#f97316",
};

// モジュールID → 相対URLパス（プロジェクトID以降）のマッピング
//
// 以前は4件が汎用ページ（/evaluations・/ebpm）を指しており、
// 自己評価をクリックすると評価一覧に飛ぶなど動線が壊れていた。
// それぞれの専用ページへ向けるよう修正している。
const MODULE_PATH: Record<string, string> = {
  dataset_manager:    "datasets",
  gap_analysis:       "gap-analysis",
  issue_hypothesis:   "issue-hypothesis",
  measure_design:     "measure-design",
  logic_model:        "logic-model",
  program_evaluation: "program-evaluation",
  cost_efficiency:    "program-evaluation", // 第5階層として統合済み
  service_volume:     "service-volume",
  self_evaluation:    "self-evaluation",
};

interface CheckpointFull extends PdcaCheckpoint {
  project_id: string;
  started_at: string | null;
  completed_at: string | null;
  completion_notes: string | null;
}

interface Props {
  checkpoint: CheckpointFull;
  projectTitle: string;
  projectId: string;
  modules: { id: string; display_name: string }[];
}

export default function CheckpointWorkClient({
  checkpoint: initialCheckpoint,
  projectTitle,
  projectId,
  modules,
}: Props) {
  const router = useRouter();
  const [checkpoint, setCheckpoint] = useState(initialCheckpoint);
  const [activeTab, setActiveTab] = useState(0);
  const [notes, setNotes] = useState(initialCheckpoint.completion_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phaseColor = PHASE_COLORS[checkpoint.phase] ?? "#94a3b8";

  async function patchStatus(status: "upcoming" | "in_progress" | "completed" | "skipped") {
    setStatusLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/pdca-checkpoints/${checkpoint.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      setCheckpoint((prev) => ({ ...prev, status }));
      router.refresh();
    } catch {
      setError("ネットワークエラーが発生しました");
    } finally {
      setStatusLoading(false);
    }
  }

  async function saveNotes() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/pdca-checkpoints/${checkpoint.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completion_notes: notes }),
        },
      );
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      setCheckpoint((prev) => ({ ...prev, completion_notes: notes }));
    } catch {
      setError("ネットワークエラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  const moduleDisplayMap = Object.fromEntries(modules.map((m) => [m.id, m.display_name]));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
      </div>

      {/* ヘッダー */}
      <div
        className="rounded-2xl border p-6 space-y-4"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <div className="flex items-start gap-3 flex-wrap">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold mt-0.5"
            style={{
              background: phaseColor + "20",
              color: phaseColor,
              border: `1px solid ${phaseColor}40`,
            }}
          >
            {checkpoint.phase}
          </span>
          {checkpoint.qc_step && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs border"
              style={{ background: "var(--bg-secondary)", color: "#94a3b8", borderColor: "var(--border)" }}
            >
              QCステップ: {checkpoint.qc_step}
            </span>
          )}
        </div>

        <div>
          <p className="text-xs text-slate-500">{projectTitle} / {checkpoint.cycle_type}</p>
          <h2 className="text-xl font-bold text-slate-100 mt-1">{checkpoint.name}</h2>
          <p className="text-sm text-slate-400 mt-1">予定日: {checkpoint.scheduled_date}</p>
        </div>

        {checkpoint.instructions && (
          <div
            className="rounded-lg p-3 text-sm text-slate-300 border"
            style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
          >
            {checkpoint.instructions}
          </div>
        )}

        {/* ステータスボタン */}
        <div className="flex items-center gap-3 flex-wrap pt-2">
          {checkpoint.status === "completed" ? (
            <span className="text-sm font-semibold" style={{ color: "#10b981" }}>
              完了済み ✓
            </span>
          ) : (
            <button
              onClick={() => patchStatus("completed")}
              disabled={statusLoading}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ background: "#10b981", color: "#fff" }}
            >
              {statusLoading ? "更新中..." : "完了にする"}
            </button>
          )}

          {checkpoint.status === "upcoming" && (
            <button
              onClick={() => patchStatus("in_progress")}
              disabled={statusLoading}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ background: "#06b6d420", color: "#22d3ee", border: "1px solid #06b6d440" }}
            >
              {statusLoading ? "更新中..." : "進行中にする"}
            </button>
          )}
        </div>

        {error && (
          <p className="text-sm" style={{ color: "#ef4444" }}>
            {error}
          </p>
        )}
      </div>

      {/* モジュールタブ */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <div className="border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex overflow-x-auto">
            {checkpoint.modules_involved.length === 0 ? (
              <span className="px-4 py-3 text-sm text-slate-500">
                このチェックポイントに関連するモジュールはありません
              </span>
            ) : (
              checkpoint.modules_involved.map((moduleId, idx) => (
                <button
                  key={moduleId}
                  onClick={() => setActiveTab(idx)}
                  className="px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors"
                  style={{
                    color: activeTab === idx ? "#6366f1" : "#94a3b8",
                    borderBottom: activeTab === idx ? "2px solid #6366f1" : "2px solid transparent",
                  }}
                >
                  {moduleDisplayMap[moduleId] ?? moduleId}
                </button>
              ))
            )}
          </div>
        </div>

        {checkpoint.modules_involved.length > 0 && (
          <div className="p-5">
            {(() => {
              const moduleId = checkpoint.modules_involved[activeTab];
              if (!moduleId) return null;
              const displayName = moduleDisplayMap[moduleId] ?? moduleId;
              const relativePath = MODULE_PATH[moduleId];
              const href =
                relativePath !== undefined
                  ? `/projects/${projectId}${relativePath ? `/${relativePath}` : ""}`
                  : null;

              return (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-slate-200">
                    {displayName} の作業
                  </p>
                  {href ? (
                    <Link
                      href={href}
                      className="inline-flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
                      style={{ color: "#06b6d4" }}
                    >
                      → {displayName} ページを開く
                    </Link>
                  ) : (
                    <p className="text-sm text-slate-500">このモジュールのページは未定義です</p>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* 完了メモ */}
      <div
        className="rounded-2xl border p-5 space-y-3"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <h3 className="text-sm font-semibold text-slate-300">完了メモ</h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="作業の記録・気づき・次回への引き継ぎ事項などを入力..."
          className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-1"
          style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            color: "#e2e8f0",
          }}
        />
        <button
          onClick={saveNotes}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
          style={{ background: "#6366f1", color: "#fff" }}
        >
          {saving ? "保存中..." : "メモを保存"}
        </button>
      </div>
    </div>
  );
}
