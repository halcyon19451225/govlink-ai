"use client";

import Link from "next/link";
import { differenceInDays, parseISO } from "date-fns";
import type { PdcaCheckpoint } from "./page";

interface Project {
  id: string;
  title: string;
  description: string | null;
  plan_start_date: string | null;
  plan_end_date: string | null;
  status: string;
}

interface Props {
  project: Project;
  checkpoints: PdcaCheckpoint[];
  projectId: string;
}

interface StatusBadge {
  bg: string;
  color: string;
  border: string;
  label: string;
}

const STATUS_BADGE: Record<string, StatusBadge> = {
  upcoming:    { bg: "#64748b18", color: "#94a3b8", border: "#64748b30", label: "未着手" },
  in_progress: { bg: "#06b6d418", color: "#22d3ee", border: "#06b6d430", label: "進行中" },
  completed:   { bg: "#10b98118", color: "#34d399", border: "#10b98130", label: "完了" },
  skipped:     { bg: "#37415118", color: "#6b7280", border: "#37415130", label: "スキップ" },
};

const DEFAULT_BADGE: StatusBadge = { bg: "#64748b18", color: "#94a3b8", border: "#64748b30", label: "未着手" };

const STATUS_TIMELINE_COLOR: Record<string, string> = {
  upcoming:    "#64748b",
  in_progress: "#06b6d4",
  completed:   "#10b981",
  skipped:     "#374151",
};

const PHASE_COLORS: Record<string, string> = {
  P:   "#6366f1",
  D:   "#06b6d4",
  C:   "#f59e0b",
  A:   "#10b981",
  "P-D": "#8b5cf6",
  "C-A": "#f97316",
};

function PhaseLabel({ phase }: { phase: string }) {
  const color = PHASE_COLORS[phase] ?? "#94a3b8";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold"
      style={{
        background: color + "20",
        color,
        border: `1px solid ${color}40`,
      }}
    >
      {phase}
    </span>
  );
}

// 計画期間のプログレスバー
// S1: 日数経過率だけでなく**チェックポイント完了率**を併記する（CA監査の残課題の解消 —
//     「時間は過ぎているのに節目を消化できていない」ずれが見えるように）
function PlanProgress({
  planStartDate,
  planEndDate,
  checkpoints,
}: {
  planStartDate: string | null;
  planEndDate: string | null;
  checkpoints: PdcaCheckpoint[];
}) {
  if (!planStartDate) {
    return (
      <div
        className="rounded-xl border px-4 py-3 text-sm"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", color: "#94a3b8" }}
      >
        計画開始日が未設定です
      </div>
    );
  }

  const today = new Date();
  const start = parseISO(planStartDate);
  const end = planEndDate ? parseISO(planEndDate) : null;

  const totalDays = end ? differenceInDays(end, start) : null;
  const elapsedDays = Math.max(0, differenceInDays(today, start));
  const pct =
    totalDays && totalDays > 0
      ? Math.min(100, Math.round((elapsedDays / totalDays) * 100))
      : null;

  return (
    <div
      className="rounded-xl border px-4 py-3 space-y-2"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>計画期間の進捗</span>
        {pct !== null && totalDays !== null ? (
          <span>
            {elapsedDays} / {totalDays} 日（{pct}%）
          </span>
        ) : (
          <span>{elapsedDays} 日経過（終了日未設定）</span>
        )}
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "var(--border)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct ?? Math.min(elapsedDays, 100)}%`,
            background: "linear-gradient(90deg, #6366f1, #06b6d4)",
          }}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>{planStartDate}</span>
        {planEndDate && <span>{planEndDate}</span>}
      </div>
      {(() => {
        const target = checkpoints.filter((c) => c.status !== "skipped");
        if (target.length === 0) return null;
        const done = target.filter((c) => c.status === "completed").length;
        const ckptPct = Math.round((done / target.length) * 100);
        const behind = pct !== null && ckptPct < pct - 15;
        return (
          <>
            <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
              <span>チェックポイント完了率</span>
              <span>
                {done} / {target.length}（{ckptPct}%）
                {behind && <span className="ml-1 text-amber-400">⚠ 期間の経過に対して遅れ気味</span>}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${ckptPct}%`, background: "linear-gradient(90deg, #f59e0b, #10b981)" }}
              />
            </div>
          </>
        );
      })()}
    </div>
  );
}

// 次のチェックポイントカード
function NextCheckpointCard({
  checkpoints,
  projectId,
}: {
  checkpoints: PdcaCheckpoint[];
  projectId: string;
}) {
  const today = new Date();
  const next = checkpoints
    .filter((c) => c.status === "upcoming" || c.status === "in_progress")
    .sort(
      (a, b) =>
        new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime(),
    )[0];

  if (!next) {
    return (
      <div
        className="rounded-xl border border-dashed p-6 text-center text-sm"
        style={{ borderColor: "var(--border)", color: "#64748b" }}
      >
        未着手・進行中のチェックポイントはありません
      </div>
    );
  }

  const daysLeft = differenceInDays(parseISO(next.scheduled_date), today);
  const badgeInfo = STATUS_BADGE[next.status] ?? DEFAULT_BADGE;

  return (
    <div
      className="rounded-xl border p-5 space-y-3"
      style={{ background: "var(--bg-secondary)", borderColor: "#6366f130" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          次のチェックポイント
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded border"
          style={{ background: badgeInfo.bg, color: badgeInfo.color, borderColor: badgeInfo.border }}
        >
          {badgeInfo.label}
        </span>
      </div>
      <div>
        <p className="text-base font-bold text-slate-100">{next.name}</p>
        <p className="text-xs text-slate-400 mt-1">
          サイクル: {next.cycle_type}　予定日: {next.scheduled_date}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="text-sm font-bold"
          style={{
            color: daysLeft < 0 ? "#ef4444" : daysLeft <= 7 ? "#f59e0b" : "#06b6d4",
          }}
        >
          {daysLeft < 0 ? `${Math.abs(daysLeft)} 日超過` : daysLeft === 0 ? "今日" : `あと ${daysLeft} 日`}
        </span>
        {next.evaluation_tiers.map((t) => (
          <span
            key={t}
            className="text-xs px-2 py-0.5 rounded border"
            style={{ background: "#6366f118", color: "#a5b4fc", borderColor: "#6366f130" }}
          >
            {t}
          </span>
        ))}
      </div>
      <Link
        href={`/projects/${projectId}/pdca/${next.id}`}
        className="inline-flex items-center gap-1 text-sm font-semibold transition-opacity hover:opacity-80"
        style={{ color: "#6366f1" }}
      >
        作業を開始する →
      </Link>
    </div>
  );
}

// 読み取り専用タイムライン
function Timeline({
  checkpoints,
  planStartDate,
  planEndDate,
  projectId,
}: {
  checkpoints: PdcaCheckpoint[];
  planStartDate: string | null;
  planEndDate: string | null;
  projectId: string;
}) {
  if (!planStartDate) return null;

  const start = parseISO(planStartDate);
  const end = planEndDate ? parseISO(planEndDate) : new Date(start.getFullYear() + 1, start.getMonth(), 1);

  // 月一覧を生成
  const months: { year: number; month: number; label: string }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= endMonth) {
    months.push({
      year: cur.getFullYear(),
      month: cur.getMonth(),
      label: `${cur.getFullYear()}/${String(cur.getMonth() + 1).padStart(2, "0")}`,
    });
    cur.setMonth(cur.getMonth() + 1);
  }

  // cycle_type の一覧（順序保持）
  const cycleTypes: string[] = [];
  for (const cp of checkpoints) {
    if (!cycleTypes.includes(cp.cycle_type)) cycleTypes.push(cp.cycle_type);
  }

  const CELL_W = 56;
  const LANE_W = 200;

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
        タイムライン
      </h3>
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <div className="overflow-x-auto">
          {/* ヘッダー行（月） */}
          <div className="flex" style={{ minWidth: LANE_W + months.length * CELL_W }}>
            <div
              className="shrink-0 px-3 py-2 text-xs font-semibold text-slate-500 border-b border-r"
              style={{ width: LANE_W, borderColor: "var(--border)" }}
            >
              サイクル
            </div>
            {months.map((m) => (
              <div
                key={m.label}
                className="shrink-0 px-1 py-2 text-center text-xs text-slate-500 border-b border-r"
                style={{ width: CELL_W, borderColor: "var(--border)" }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {/* レーン行 */}
          {cycleTypes.map((ct) => {
            const laneCheckpoints = checkpoints.filter((c) => c.cycle_type === ct);
            return (
              <div
                key={ct}
                className="flex relative"
                style={{ minWidth: LANE_W + months.length * CELL_W, minHeight: 40 }}
              >
                {/* レーン名 */}
                <div
                  className="shrink-0 px-3 py-2 text-xs text-slate-300 border-b border-r flex items-center"
                  style={{ width: LANE_W, borderColor: "var(--border)" }}
                >
                  {ct}
                </div>

                {/* 月セル背景 */}
                {months.map((m, mi) => (
                  <div
                    key={mi}
                    className="shrink-0 border-b border-r"
                    style={{ width: CELL_W, borderColor: "var(--border)" }}
                  />
                ))}

                {/* チェックポイントブロックをオーバーレイ */}
                <div
                  className="absolute top-1 flex gap-0.5"
                  style={{ left: LANE_W }}
                >
                  {laneCheckpoints.map((cp) => {
                    const cpDate = parseISO(cp.scheduled_date);
                    const monthIdx = months.findIndex(
                      (m) =>
                        m.year === cpDate.getFullYear() &&
                        m.month === cpDate.getMonth(),
                    );
                    if (monthIdx < 0) return null;
                    const color = STATUS_TIMELINE_COLOR[cp.status] ?? "#64748b";
                    return (
                      <Link
                        key={cp.id}
                        href={`/projects/${projectId}/pdca/${cp.id}`}
                        title={cp.name}
                        style={{
                          position: "absolute",
                          left: monthIdx * CELL_W + 4,
                          width: CELL_W - 8,
                          background: color + "30",
                          border: `1px solid ${color}60`,
                          borderRadius: 4,
                          height: 28,
                          display: "flex",
                          alignItems: "center",
                          paddingLeft: 4,
                          paddingRight: 4,
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          className="text-xs truncate font-medium"
                          style={{ color }}
                        >
                          {cp.name}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function PdcaDashboardClient({ project, checkpoints, projectId }: Props) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <p className="text-sm text-slate-500">{project.title}</p>
        <h2 className="text-2xl font-bold text-slate-100 mt-1">PDCAダッシュボード</h2>
      </div>

      {/* A. 計画期間プログレスバー（＋チェックポイント完了率 — S1） */}
      <PlanProgress
        planStartDate={project.plan_start_date}
        planEndDate={project.plan_end_date}
        checkpoints={checkpoints}
      />

      {/* B. 次のチェックポイントカード */}
      <NextCheckpointCard checkpoints={checkpoints} projectId={projectId} />

      {/* C. タイムライン */}
      <Timeline
        checkpoints={checkpoints}
        planStartDate={project.plan_start_date}
        planEndDate={project.plan_end_date}
        projectId={projectId}
      />

      {/* D. チェックポイント一覧テーブル */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
          チェックポイント一覧
        </h3>
        {checkpoints.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-8 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm text-slate-400">PDCAチェックポイントがまだありません。</p>
            <p className="text-xs text-slate-500 mt-2">
              プロジェクト作成時にテンプレートを選択するとチェックポイントが自動生成されます。
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-left text-xs text-slate-500 uppercase tracking-wider border-b"
                  style={{ borderColor: "var(--border)" }}
                >
                  <th className="px-4 py-3">チェックポイント名</th>
                  <th className="px-4 py-3">フェーズ</th>
                  <th className="px-4 py-3">予定日</th>
                  <th className="px-4 py-3">ステータス</th>
                  <th className="px-4 py-3">評価階層</th>
                  <th className="px-4 py-3">アクション</th>
                </tr>
              </thead>
              <tbody>
                {checkpoints.map((cp) => {
                  const badge = STATUS_BADGE[cp.status] ?? DEFAULT_BADGE;
                  return (
                    <tr
                      key={cp.id}
                      className="border-b last:border-0 hover:bg-white/5 transition-colors"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="px-4 py-3 font-medium text-slate-200">{cp.name}</td>
                      <td className="px-4 py-3">
                        <PhaseLabel phase={cp.phase} />
                      </td>
                      <td className="px-4 py-3 text-slate-400">{cp.scheduled_date}</td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-block text-xs px-2 py-0.5 rounded border"
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderColor: badge.border,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {cp.evaluation_tiers.map((t) => (
                            <span
                              key={t}
                              className="text-xs px-1.5 py-0.5 rounded border"
                              style={{
                                background: "#6366f110",
                                color: "#a5b4fc",
                                borderColor: "#6366f128",
                              }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/projects/${projectId}/pdca/${cp.id}`}
                          className="text-xs font-medium transition-opacity hover:opacity-70"
                          style={{ color: "#6366f1" }}
                        >
                          → 作業へ
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
