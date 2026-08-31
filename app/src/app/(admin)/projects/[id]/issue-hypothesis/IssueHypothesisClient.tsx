"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PermissionGate from "@/components/PermissionGate";
import AiThinkingIndicator from "@/components/AiThinkingIndicator";
import CopyButton from "@/components/CopyButton";
import { formatMessage, formatTranscript } from "@/lib/ai/transcript";
import {
  isAcceptedTurn,
  requestTurnStep,
  isTurnProcessing,
  waitForTurn,
  type TurnStatus,
} from "@/lib/ai/turnClient";
import {
  ISSUE_STEP_ORDER,
  ISSUE_STEP_LABEL,
  ISSUE_STEP_HINT,
  PROBLEM_ORIGIN_META,
  SELECTION_AXIS_META,
  factorColor,
  factorLabel,
  factorShortLabel,
  isProblemOrigin,
  findSelectionInconsistencies,
  issueScoreFormula,
  unresolvedRootCauseIds,
  selectedActiveProblemIds,
  type HypothesisItem,
  type IssueMessage,
  type IssueStep,
  type IssueReference,
  type ProblemItem,
  type RootCauseItem,
  type SelectionItem,
} from "@/lib/issue/types";

// ─── 型 ─────────────────────────────────────
export interface IssueDialogueRecord {
  id: string;
  kpi_id: string | null;
  kpi_label: string | null;
  gap_analysis_id: string | null;
  asis_analysis_id: string | null;
  title: string;
  status: "in_progress" | "completed";
  current_step: IssueStep;
  messages: IssueMessage[];
  problems: ProblemItem[];
  selection: SelectionItem[];
  root_causes: RootCauseItem[];
  hypotheses: HypothesisItem[];
  /** AIターンの状態（migration 055・非同期化）。processing の間はポーリングで待つ */
  turn_status?: TurnStatus | null;
  turn_error?: string | null;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommittedHypothesis {
  id: string;
  issue_dialogue_id: string | null;
  title: string;
  description: string | null;
  root_cause: string | null;
  priority_rank: number | null;
  status: string;
  evidence_sources: string[] | null;
  proposed_measures: string[] | null;
}

export interface KpiRow {
  id: string;
  label: string;
  unit: string;
}

interface Props {
  project: { id: string; title: string };
  projectId: string;
  initialDialogues: IssueDialogueRecord[];
  kpis: KpiRow[];
  initialCommitted: CommittedHypothesis[];
}

// ─── 小物 ────────────────────────────────────
function OriginBadge({ origin }: { origin: string }) {
  const m = isProblemOrigin(origin)
    ? PROBLEM_ORIGIN_META[origin]
    : PROBLEM_ORIGIN_META.dialogue;
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
      style={{ background: `${m.color}22`, color: m.color, border: `1px solid ${m.color}55` }}
      title={`出所: ${m.label}`}
    >
      {m.label}
    </span>
  );
}

function FactorBadge({ factor }: { factor: string }) {
  const color = factorColor(factor);
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
      title={`特性要因図の大骨: ${factorLabel(factor)}`}
    >
      {factorShortLabel(factor)}
    </span>
  );
}

/** QCストーリーの進行状況 */
function StepProgress({ step }: { step: IssueStep }) {
  const currentIdx = ISSUE_STEP_ORDER.indexOf(step);
  return (
    <ol className="space-y-1.5">
      {ISSUE_STEP_ORDER.filter((s) => s !== "done").map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const color = done ? "#10b981" : active ? "#818cf8" : "#64748b";
        return (
          <li key={s} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                width: 18,
                height: 18,
                marginTop: 1,
                background: done || active ? `${color}25` : "transparent",
                color,
                border: `1.5px solid ${color}`,
              }}
            >
              {done ? "✓" : i + 1}
            </span>
            <span>
              <span
                className="text-[11px] font-semibold"
                style={{ color: active ? "#c7d2fe" : done ? "#10b981" : "#94a3b8" }}
              >
                {ISSUE_STEP_LABEL[s]}
                {active && <span className="ml-1 text-[10px] font-normal">← 現在</span>}
              </span>
              {active && (
                <span className="block text-[10px] text-slate-500 leading-snug mt-0.5">
                  {ISSUE_STEP_HINT[s]}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── 問題一覧 ────────────────────────────────
function ProblemList({
  problems,
  selection,
  compact,
}: {
  problems: ProblemItem[];
  selection: SelectionItem[];
  compact?: boolean;
}) {
  const selMap = new Map(selection.map((s) => [s.problem_id, s]));
  if (problems.length === 0) {
    return <p className="text-[11px] text-slate-600">まだ洗い出されていません</p>;
  }
  return (
    <ul className="space-y-1.5">
      {problems.map((p) => {
        // 退役（統合）した問題は消さずに残す。IDを消すと選別・真因・仮説の参照が壊れるため、
        // 「どこへ統合されたか」を見せたうえで選外扱いにする
        const retired = p.retired === true;
        const sel = retired ? undefined : selMap.get(p.id);
        return (
          <li
            key={p.id}
            className="rounded-lg px-2 py-1.5"
            style={{
              background: sel?.selected ? "#10b98112" : "var(--bg-primary)",
              border: `1px solid ${sel?.selected ? "#10b98140" : "var(--border)"}`,
              opacity: retired ? 0.55 : 1,
            }}
          >
            <div className="flex items-start gap-1.5 flex-wrap">
              <span className="text-[10px] font-mono text-slate-500 shrink-0">{p.id}</span>
              <OriginBadge origin={p.origin} />
              {p.factor && <FactorBadge factor={p.factor} />}
              {retired && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0"
                  style={{ background: "#94a3b825", color: "#94a3b8" }}
                >
                  {p.merged_into ? `${p.merged_into} に統合` : "統合済み"}
                </span>
              )}
              {sel?.selected && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0"
                  style={{ background: "#10b98125", color: "#10b981" }}
                >
                  課題として選定
                </span>
              )}
            </div>
            <p
              className="text-[11px] text-slate-300 leading-snug mt-1"
              style={retired ? { textDecoration: "line-through" } : undefined}
            >
              {p.text}
            </p>
            {!compact &&
              p.source_text &&
              // 統合で複数の出所を引き継いだ場合は改行区切り。1件ずつ引用して、
              // 別々のSWOT項目が1つの引用に見えないようにする
              p.source_text
                .split("\n")
                .map((t) => t.trim())
                .filter((t) => t.length > 0)
                .map((t, i) => (
                  <p key={i} className="text-[10px] text-slate-500 leading-snug mt-1">
                    現状整理より: 「{t}」
                  </p>
                ))}
          </li>
        );
      })}
    </ul>
  );
}

// ─── 課題の選別（重点指向）───────────────────────
function SelectionView({
  problems,
  selection,
}: {
  problems: ProblemItem[];
  selection: SelectionItem[];
}) {
  if (selection.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        まだ選別されていません。対話を「課題の選別」まで進めてください。
      </p>
    );
  }
  const problemMap = new Map(problems.map((p) => [p.id, p]));
  const sorted = [...selection].sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border px-4 py-3 text-[11px] leading-relaxed text-slate-400"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        JIS Q 9024 の重点指向にもとづき、全部を一度に扱わず「特に解決すべきもの」を絞り込みます。
        各軸を1〜5で評価し、
        {SELECTION_AXIS_META.map((a, i) => (
          <span key={a.key}>
            {i > 0 ? " ＋ " : " "}
            <span className="text-slate-200">{a.label}</span>
          </span>
        ))}{" "}
        を重み付けして合計します。
      </div>

      <div className="space-y-3">
        {sorted.map((s) => {
          const p = problemMap.get(s.problem_id);
          const accent = s.selected ? "#10b981" : "#64748b";
          return (
            <div
              key={s.problem_id}
              className="rounded-lg border p-4"
              style={{
                background: "var(--bg-secondary)",
                borderColor: s.selected ? "#10b98140" : "var(--border)",
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-start gap-2 flex-wrap min-w-0">
                  <span className="text-[10px] font-mono text-slate-500 mt-0.5">
                    {s.problem_id}
                  </span>
                  {p && <OriginBadge origin={p.origin} />}
                  <span className="text-xs text-slate-200 leading-snug">
                    {p?.text ?? "(問題が見つかりません)"}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-lg font-bold font-mono" style={{ color: accent }}>
                    {s.score}
                  </span>
                  <span className="text-[10px] text-slate-500 block leading-none">/ 100</span>
                </div>
              </div>

              <div
                className="rounded-full overflow-hidden mb-2"
                style={{ background: "var(--border)", height: 8 }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${s.score}%`, background: accent }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                {SELECTION_AXIS_META.map((a) => (
                  <span key={a.key} title={a.desc}>
                    {a.label}{" "}
                    <span className="font-mono text-slate-200">{s[a.key]}</span>
                    <span className="text-slate-600">/5</span>
                  </span>
                ))}
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={
                    s.selected
                      ? { background: "#10b98120", color: "#10b981", border: "1px solid #10b98140" }
                      : { background: "#64748b20", color: "#94a3b8" }
                  }
                >
                  {s.selected ? "★ 課題として選定" : "選外"}
                </span>
              </div>

              {s.reason && (
                <p className="text-[11px] text-slate-400 leading-snug mt-2">{s.reason}</p>
              )}
              <p className="text-[10px] text-slate-600 font-mono mt-1.5 break-all">
                {issueScoreFormula(s)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 特性要因図（石川ダイアグラム）─────────────────
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function FishboneDiagram({
  problemText,
  bones,
}: {
  problemText: string;
  bones: RootCauseItem["bones"];
}) {
  const W = 900;
  const H = 440;
  const cy = H / 2;
  const headX = W - 190;

  const upper = bones.filter((_, i) => i % 2 === 0);
  const lower = bones.filter((_, i) => i % 2 === 1);

  const spanStart = 130;
  const spanEnd = headX - 30;
  const span = spanEnd - spanStart;

  const boneGeometry = (list: typeof bones, up: boolean) =>
    list.map((bone, i) => {
      const x = spanStart + (span * (i + 0.75)) / Math.max(list.length, 1);
      const dir = up ? -1 : 1;
      const endX = x - 70;
      const endY = cy + dir * 118;
      return { bone, x, endX, endY, dir };
    });

  const geo = [...boneGeometry(upper, true), ...boneGeometry(lower, false)];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 720 }}
        role="img"
        aria-label={`特性要因図: 特性「${problemText}」に対する要因 ${bones
          .map((b) => factorShortLabel(b.factor))
          .join("、")}`}
      >
        {/* 背骨 */}
        <line x1={40} y1={cy} x2={headX} y2={cy} stroke="#64748b" strokeWidth={2.5} />
        <polygon
          points={`${headX},${cy - 7} ${headX + 12},${cy} ${headX},${cy + 7}`}
          fill="#64748b"
        />

        {/* 特性（解決すべき課題） */}
        <rect
          x={headX + 14}
          y={cy - 42}
          width={168}
          height={84}
          rx={8}
          fill="rgba(99,102,241,0.16)"
          stroke="#818cf8"
          strokeWidth={1.5}
        />
        <text x={headX + 98} y={cy - 22} textAnchor="middle" fontSize={10} fill="#a5b4fc">
          特性（課題）
        </text>
        {truncate(problemText, 45)
          .match(/.{1,15}/g)
          ?.slice(0, 3)
          .map((line, i) => (
            <text
              key={i}
              x={headX + 98}
              y={cy - 4 + i * 15}
              textAnchor="middle"
              fontSize={11}
              fill="#e2e8f0"
            >
              {line}
            </text>
          ))}

        {/* 大骨と小骨 */}
        {geo.map(({ bone, x, endX, endY, dir }, bi) => {
          const color = factorColor(bone.factor);
          const shown = bone.causes.slice(0, 3);
          return (
            <g key={`${bone.factor}-${bi}`}>
              <title>
                {factorLabel(bone.factor)}: {bone.causes.join(" / ")}
              </title>
              <line
                x1={x}
                y1={cy}
                x2={endX}
                y2={endY}
                stroke={color}
                strokeWidth={2}
              />
              <rect
                x={endX - 46}
                y={endY + (dir < 0 ? -26 : 6)}
                width={92}
                height={20}
                rx={5}
                fill={`${color}25`}
                stroke={color}
                strokeWidth={1}
              />
              <text
                x={endX}
                y={endY + (dir < 0 ? -12 : 20)}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill={color}
              >
                {truncate(factorShortLabel(bone.factor), 7)}
              </text>

              {shown.map((cause, ci) => {
                const t = 0.32 + ci * 0.22;
                const px = x + (endX - x) * t;
                const py = cy + (endY - cy) * t;
                return (
                  <g key={ci}>
                    <line
                      x1={px}
                      y1={py}
                      x2={px + 62}
                      y2={py}
                      stroke={color}
                      strokeWidth={1}
                      opacity={0.75}
                    />
                    <text
                      x={px + 66}
                      y={py + 3.5}
                      fontSize={10}
                      fill="#cbd5e1"
                    >
                      {truncate(cause, 13)}
                    </text>
                  </g>
                );
              })}
              {bone.causes.length > 3 && (
                <text x={endX + 52} y={endY + (dir < 0 ? 6 : -6)} fontSize={9} fill="#94a3b8">
                  ほか{bone.causes.length - 3}件
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── なぜなぜ分析 ────────────────────────────
function WhyChain({ item }: { item: RootCauseItem }) {
  if (item.whys.length === 0 && !item.root_cause) return null;
  return (
    <div className="space-y-1.5">
      {item.whys.map((w) => (
        <div key={w.level} className="flex items-start gap-2">
          <span
            className="shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5 mt-0.5"
            style={{ background: "#6366f120", color: "#818cf8", border: "1px solid #6366f140" }}
          >
            なぜ{w.level}
          </span>
          <div className="min-w-0">
            {w.question && (
              <p className="text-[10px] text-slate-500 leading-snug">{w.question}</p>
            )}
            <p className="text-xs text-slate-300 leading-snug">{w.answer}</p>
          </div>
        </div>
      ))}
      {item.root_cause && (
        <div
          className="rounded-lg px-3 py-2 mt-2"
          style={{ background: "#ef444412", border: "1px solid #ef444440" }}
        >
          <p className="text-[10px] font-semibold mb-0.5" style={{ color: "#f87171" }}>
            ▼ 到達した真因
          </p>
          <p className="text-xs text-slate-200 leading-snug">{item.root_cause}</p>
        </div>
      )}
    </div>
  );
}

function RootCauseView({
  problems,
  rootCauses,
}: {
  problems: ProblemItem[];
  rootCauses: RootCauseItem[];
}) {
  if (rootCauses.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        まだ真因分析が行われていません。対話を「真因分析」まで進めてください。
      </p>
    );
  }
  const problemMap = new Map(problems.map((p) => [p.id, p]));

  return (
    <div className="space-y-5">
      <div
        className="rounded-lg border px-4 py-3 text-[11px] leading-relaxed text-slate-400"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        特性要因図の大骨には、現状整理（As-Is）で使った PESTLE（外部環境）/ 7S（内部環境）の
        区分をそのまま用いています。同じタグ体系で辿れるため、SWOT → 問題 → 要因 → 真因の
        つながりを検証できます。
      </div>

      {rootCauses.map((rc) => {
        const p = problemMap.get(rc.problem_id);
        return (
          <div
            key={rc.problem_id}
            className="rounded-xl border p-4"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <div className="flex items-start gap-2 flex-wrap mb-3">
              <span className="text-[10px] font-mono text-slate-500 mt-0.5">{rc.problem_id}</span>
              {p && <OriginBadge origin={p.origin} />}
              <h3 className="text-sm font-semibold text-slate-100">
                {p?.text ?? "(問題が見つかりません)"}
              </h3>
            </div>

            {rc.bones.length > 0 && (
              <div
                className="rounded-lg mb-4 p-2"
                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
              >
                <FishboneDiagram problemText={p?.text ?? rc.problem_id} bones={rc.bones} />
              </div>
            )}

            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <p className="text-[11px] font-semibold text-slate-400 mb-1.5">
                  要因（特性要因図の全項目）
                </p>
                {rc.bones.length === 0 ? (
                  <p className="text-[11px] text-slate-600">—</p>
                ) : (
                  <ul className="space-y-1.5">
                    {rc.bones.map((b, i) => (
                      <li key={i}>
                        <FactorBadge factor={b.factor} />
                        <ul className="mt-1 ml-1 space-y-0.5">
                          {b.causes.map((c, ci) => (
                            <li key={ci} className="text-[11px] text-slate-300 leading-snug">
                              ・{c}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-slate-400 mb-1.5">
                  なぜなぜ分析
                </p>
                <WhyChain item={rc} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 課題仮説 ────────────────────────────────
function HypothesisView({
  problems,
  hypotheses,
  selection,
  committed,
  onCommit,
  committing,
  onInherit,
  canEdit,
}: {
  problems: ProblemItem[];
  hypotheses: HypothesisItem[];
  selection: SelectionItem[];
  committed: CommittedHypothesis[];
  onCommit: () => void;
  committing: boolean;
  onInherit: (h: CommittedHypothesis) => void;
  canEdit: boolean;
}) {
  if (hypotheses.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        まだ課題仮説が作成されていません。対話を「仮説の定式化」まで進めてください。
      </p>
    );
  }
  const problemMap = new Map(problems.map((p) => [p.id, p]));
  const selMap = new Map(selection.map((x) => [x.problem_id, x]));
  const committedByTitle = new Map(committed.map((c) => [c.title, c]));
  // 書き出し前でも順位を見せる。書き出し時のランクは選別スコアの降順で採番されるので、
  // 同じ規則で「予定順位」を出しておく（書き出してから順序を知る、という状態を避ける）
  const plannedRank = new Map<string, number>();
  [...hypotheses]
    .sort(
      (a, b) =>
        (selMap.get(b.problem_id)?.score ?? 0) - (selMap.get(a.problem_id)?.score ?? 0),
    )
    .forEach((h, i) => {
      if (!plannedRank.has(h.problem_id)) plannedRank.set(h.problem_id, i + 1);
    });

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <p className="text-[11px] leading-relaxed text-slate-400">
          仮説は「真因を解消すれば指標がどう動くか」を検証可能な形にしたものです。
          仮説一覧へ書き出すと、ロジックモデルへ引き継げるようになります。
        </p>
        {canEdit && (
          <button
            onClick={onCommit}
            disabled={committing}
            className="text-xs px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 shrink-0"
            style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
          >
            {committing ? "書き出し中..." : committed.length > 0 ? "仮説一覧を更新" : "仮説一覧へ書き出す"}
          </button>
        )}
      </div>

      {hypotheses.map((h, i) => {
        const p = problemMap.get(h.problem_id);
        const sel = selMap.get(h.problem_id);
        const c = committedByTitle.get(h.title);
        return (
          <div
            key={`${h.problem_id}-${i}`}
            className="rounded-xl border p-5"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <h3 className="text-sm font-semibold text-slate-100">{h.title}</h3>
                {p && <OriginBadge origin={p.origin} />}
                {c && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: "#10b98120", color: "#10b981" }}
                  >
                    書き出し済み
                  </span>
                )}
                {/* 優先順位は選別スコアの降順で採番される。なぜこの順かを画面で辿れるようにする。
                    書き出し前は同じ規則で計算した「予定」を出す */}
                {(c?.priority_rank ?? plannedRank.get(h.problem_id)) != null && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-mono"
                    style={{ background: "#6366f120", color: "#818cf8" }}
                    title="選別スコアの降順で採番された優先順位"
                  >
                    優先度 {c?.priority_rank ?? plannedRank.get(h.problem_id)}位
                    {c?.priority_rank == null ? "（予定）" : ""}
                    {sel ? `（選別 ${sel.score}点）` : ""}
                  </span>
                )}
              </div>
              {c && (
                <button
                  onClick={() => onInherit(c)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0"
                  style={{ background: "#6366f118", color: "#818cf8", border: "1px solid #6366f140" }}
                >
                  ロジックモデルに引き継ぐ
                </button>
              )}
            </div>

            <p
              className="text-sm text-slate-200 leading-relaxed rounded-lg px-3 py-2 mb-3"
              style={{ background: "#6366f110", border: "1px solid #6366f130" }}
            >
              {h.statement}
            </p>

            <dl className="space-y-2 text-xs">
              {h.root_cause && (
                <div>
                  <dt className="text-[11px] font-semibold text-slate-400">真因</dt>
                  <dd className="text-slate-300 leading-snug">{h.root_cause}</dd>
                </div>
              )}
              {h.measures.length > 0 && (
                <div>
                  <dt className="text-[11px] font-semibold text-slate-400">施策の方向性</dt>
                  <dd>
                    <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                      {h.measures.map((m, mi) => (
                        <li key={mi}>{m}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {h.evidence.length > 0 && (
                <div>
                  <dt className="text-[11px] font-semibold text-slate-400">根拠・出典</dt>
                  <dd>
                    <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                      {h.evidence.map((e, ei) => (
                        <li key={ei}>{e}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {h.verification && (
                <div>
                  <dt className="text-[11px] font-semibold text-slate-400">検証方法</dt>
                  <dd className="text-slate-300 leading-snug">{h.verification}</dd>
                </div>
              )}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/** AIの発言に添えられた出典。無いのに固有名詞を挙げている場合は検証を促す */
function MessageSources({
  references,
  unsourced,
}: {
  references?: IssueReference[] | undefined;
  unsourced?: boolean | undefined;
}) {
  if (references && references.length > 0) {
    return (
      <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px dashed var(--border)" }}>
        <p className="text-[10px] font-semibold text-slate-500 mb-0.5">出典</p>
        <ul className="space-y-0.5">
          {references.map((r, i) => (
            <li key={i} className="text-[10px] text-slate-400 leading-snug">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:brightness-125"
                  style={{ color: "#818cf8" }}
                >
                  {r.title}
                </a>
              ) : (
                r.title
              )}
              {r.note ? ` — ${r.note}` : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (unsourced) {
    return (
      <p
        className="text-[10px] leading-snug mt-1.5 pt-1.5"
        style={{ color: "#fbbf24", borderTop: "1px dashed var(--border)" }}
      >
        ⚠ 制度名・調査名を挙げていますが出典が示されていません。計画書に載せる前に確認してください
      </p>
    );
  }
  return null;
}

/** 選定したのに真因まで掘れていない課題を知らせる */
function UnresolvedRootCauseNotice({
  problems,
  selection,
  rootCauses,
  step,
}: {
  problems: ProblemItem[];
  selection: SelectionItem[];
  rootCauses: RootCauseItem[];
  step: IssueStep;
}) {
  const pending = unresolvedRootCauseIds(problems, selection, rootCauses);
  if (pending.length === 0) return null;
  // 真因分析の前は、まだ着手していないだけなので出さない。
  const at = ISSUE_STEP_ORDER.indexOf(step);
  if (at < ISSUE_STEP_ORDER.indexOf("rootcause")) return null;

  // 真因分析の最中に残っているのは工程が進んでいるだけ＝進捗として淡く出す。
  // それより先へ進んでいるのに残っているのは異常＝警告として出す。
  // （工程の通常状態を赤い警告で出し続けると、本当の異常時に見過ごされる）
  const total = selectedActiveProblemIds(problems, selection).length;
  const inProgress = step === "rootcause";
  const color = inProgress ? "#94a3b8" : "#f87171";
  return (
    <div
      className="rounded-lg border px-2 py-1.5 mb-2"
      style={{
        borderColor: inProgress ? "#94a3b840" : "#f8717140",
        background: inProgress ? "#94a3b810" : "#f8717110",
      }}
    >
      <p className="text-[10px] font-semibold" style={{ color }}>
        {inProgress
          ? `真因 ${total - pending.length}/${total} 件｜未着手: ${pending.join("、")}`
          : `⚠ 真因まで掘れていない課題があります: ${pending.join("、")}`}
      </p>
      <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
        選定した課題は1件ずつ特性要因図となぜなぜ分析を行う工程です。欠けたままだと、その課題は現状整理から真因までの筋道が残りません
      </p>
    </div>
  );
}

/** 選定と点数の矛盾（重点指向の破れ）を担当者に見せる */
function SelectionInconsistencyNotice({
  problems,
  selection,
}: {
  problems: ProblemItem[];
  selection: SelectionItem[];
}) {
  const bad = findSelectionInconsistencies(problems, selection);
  if (bad.length === 0) return null;
  const pairs = Array.from(
    new Map(bad.map((b) => [`${b.selected_id}<${b.unselected_id}`, b])).values(),
  ).slice(0, 5);
  return (
    <div
      className="rounded-lg border px-2 py-1.5 mb-2"
      style={{ borderColor: "#fbbf2440", background: "#fbbf2410" }}
    >
      <p className="text-[10px] font-semibold" style={{ color: "#fbbf24" }}>
        ⚠ 選定と点数が噛み合っていません
      </p>
      <ul className="mt-0.5 space-y-0.5">
        {pairs.map((b, i) => (
          <li key={i} className="text-[10px] text-slate-400 leading-snug">
            選定 {b.selected_id}（{b.selected_score}点） ＜ 選外 {b.unselected_id}（
            {b.unselected_score}点）
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-slate-500 leading-snug mt-0.5">
        点数の付け直しか、低い点数でも選ぶ理由の明記をAIに依頼してください（優先順位は点数の降順で採番されます）
      </p>
    </div>
  );
}

// ─── 対話履歴 ────────────────────────────────
function TranscriptView({ messages }: { messages: IssueMessage[] }) {
  return (
    <div
      className="rounded-xl border p-4 space-y-3 max-h-[600px] overflow-y-auto"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      {messages.length > 0 && (
        <div className="flex justify-end">
          <CopyButton
            variant="outline"
            label="対話全体をコピー"
            text={() =>
              formatTranscript(messages, {
                title: "課題仮説設定 — 対話履歴",
                stepLabel: (k) => ISSUE_STEP_LABEL[k as IssueStep] ?? k,
              })
            }
          />
        </div>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-slate-500">対話の記録がありません</p>
      ) : (
        messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[80%]">
              <div
                className={`flex items-center gap-1 mb-0.5 ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <p className="text-[10px] text-slate-500">
                  {m.role === "user" ? "担当者" : "AI"}
                  {m.step ? `・${ISSUE_STEP_LABEL[m.step]}` : ""}
                </p>
                <CopyButton
                  text={() => formatMessage(m, (k) => ISSUE_STEP_LABEL[k as IssueStep] ?? k)}
                  title="この発言をコピー"
                />
              </div>
              <div
                className="rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed"
                style={
                  m.role === "user"
                    ? { background: "#6366f1", color: "#fff" }
                    : {
                        background: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border)",
                      }
                }
              >
                {m.content}
                {m.role === "assistant" && (
                  <MessageSources references={m.references} unsourced={m.unsourced} />
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── 結果ビュー ──────────────────────────────
type ResultTab = "problems" | "selection" | "rootcause" | "hypothesis" | "dialogue";

function ResultView({
  record,
  committed,
  onCommit,
  committing,
  onInherit,
  canEdit,
}: {
  record: IssueDialogueRecord;
  committed: CommittedHypothesis[];
  onCommit: () => void;
  committing: boolean;
  onInherit: (h: CommittedHypothesis) => void;
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<ResultTab>("hypothesis");
  const tabs: { key: ResultTab; label: string }[] = [
    { key: "problems", label: "問題一覧" },
    { key: "selection", label: "課題の選別" },
    { key: "rootcause", label: "真因分析" },
    { key: "hypothesis", label: "課題仮説" },
    { key: "dialogue", label: "💬 対話履歴" },
  ];

  return (
    <div>
      <div
        className="flex gap-1 mb-4 rounded-lg p-1 flex-wrap"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          width: "fit-content",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={tab === t.key ? { background: "#6366f1", color: "#fff" } : { color: "#94a3b8" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "problems" && (
        <div
          className="rounded-xl border p-4"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <ProblemList problems={record.problems} selection={record.selection} />
        </div>
      )}
      {tab === "selection" && (
        <SelectionView problems={record.problems} selection={record.selection} />
      )}
      {tab === "rootcause" && (
        <RootCauseView problems={record.problems} rootCauses={record.root_causes} />
      )}
      {tab === "hypothesis" && (
        <HypothesisView
          problems={record.problems}
          hypotheses={record.hypotheses}
          selection={record.selection}
          committed={committed}
          onCommit={onCommit}
          committing={committing}
          onInherit={onInherit}
          canEdit={canEdit}
        />
      )}
      {tab === "dialogue" && <TranscriptView messages={record.messages} />}
    </div>
  );
}

// ─── メインコンポーネント ───────────────────────
export default function IssueHypothesisClient({
  project,
  projectId,
  initialDialogues,
  kpis,
  initialCommitted,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const kpiIdParam = searchParams.get("kpiId");

  const [records, setRecords] = useState<IssueDialogueRecord[]>(initialDialogues);
  const [committed, setCommitted] = useState<CommittedHypothesis[]>(initialCommitted);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialDialogues.find((r) => r.status === "in_progress")?.id ??
      initialDialogues[0]?.id ??
      null,
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 出所（現状整理からの引用原文）の表示。トレーサビリティの確認は対話の途中でこそ必要なので、
  // 完了後の結果ビューを待たずにサイドバーからも開けるようにする
  const [showSource, setShowSource] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newKpiId, setNewKpiId] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = records.find((r) => r.id === selectedId) ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const kpiAutoStarted = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [selected?.messages.length, selectedId]);

  const loadRecord = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/issue-dialogue/${id}`);
      const json = (await res.json()) as {
        data: IssueDialogueRecord | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "課題仮説設定の読み込みに失敗しました");
        return false;
      }
      const rec = json.data;
      setRecords((prev) =>
        prev.some((r) => r.id === rec.id)
          ? prev.map((r) => (r.id === rec.id ? rec : r))
          : [rec, ...prev],
      );
      setSelectedId(rec.id);
      return true;
    } catch {
      setError("通信エラーが発生しました");
      return false;
    }
  };

  // ?kpiId= で来た場合、対象KPIの課題仮説設定を特定（なければ作成）して即対話表示
  useEffect(() => {
    if (!kpiIdParam || kpiAutoStarted.current) return;
    kpiAutoStarted.current = true;

    const existing = records.find((r) => r.kpi_id === kpiIdParam);
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/admin/projects/${projectId}/issue-dialogue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kpi_id: kpiIdParam }),
        });
        const json = (await res.json()) as {
          data: { id: string } | null;
          error: string | null;
        };
        if (!res.ok || !json.data) {
          setError(json.error ?? "課題仮説設定の開始に失敗しました");
          return;
        }
        await loadRecord(json.data.id);
      } catch {
        setError("通信エラーが発生しました");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiIdParam]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/issue-dialogue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpi_id: newKpiId || null }),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "作成に失敗しました");
        return;
      }
      setShowCreate(false);
      setNewKpiId("");
      await loadRecord(json.data.id);
    } finally {
      setCreating(false);
    }
  };

  /** 202 受理後、GET をポーリングして結果を取り込む（再読み込み後の再開にも使う） */
  const awaitTurn = async (dialogueId: string) => {
    setSending(true);
    try {
      const rec = await waitForTurn<IssueDialogueRecord>(
        `/api/admin/projects/${projectId}/issue-dialogue/${dialogueId}`,
      );
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? { ...r, ...rec } : r)));
      if (rec.turn_status === "error") {
        setError(rec.turn_error ?? "AI処理に失敗しました");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラーが発生しました");
    } finally {
      setSending(false);
    }
  };

  // 画面を開いた時点で処理中（送信後に再読み込みした等）なら、待ち受けを再開する
  const resumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || !isTurnProcessing(selected) || sending) return;
    if (resumedFor.current === selected.id) return;
    resumedFor.current = selected.id;
    void awaitTurn(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.turn_status]);

  const handleSend = async () => {
    if (!selected || !input.trim() || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    const optimistic: IssueMessage = {
      role: "user",
      content: text,
      step: selected.current_step,
    };
    setRecords((prev) =>
      prev.map((r) =>
        r.id === selected.id ? { ...r, messages: [...r.messages, optimistic] } : r,
      ),
    );

    let accepted = false;
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/issue-dialogue/${selected.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        },
      );
      const json = (await res.json()) as {
        data: {
          turn_status?: TurnStatus;
          messages: IssueMessage[];
        } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "送信に失敗しました");
        setRecords((prev) =>
          prev.map((r) =>
            r.id === selected.id
              ? { ...r, messages: r.messages.filter((m) => m !== optimistic) }
              : r,
          ),
        );
        setInput(text);
        return;
      }
      // 発言はサーバーに保存済み。AI処理は非同期なのでポーリングで結果を待つ
      if (isAcceptedTurn(res.status, json.data)) {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === selected.id
              ? { ...r, messages: json.data!.messages, turn_status: "processing" }
              : r,
          ),
        );
        accepted = true;
        // AI処理の実体は画面から起動する（サーバーの自己呼び出しは Lambda 凍結で届かない）
        requestTurnStep(`/api/admin/projects/${projectId}/issue-dialogue/${selected.id}/chat`);
      }
    } catch {
      // 送信自体が失敗した可能性もあるが、届いていれば再読み込みで反映される
      setError("通信エラーが発生しました。画面を再読み込みすると状態を確認できます");
      setInput(text);
    } finally {
      if (!accepted) setSending(false);
    }
    if (accepted) await awaitTurn(selected.id);
  };

  /** 失敗したターンを、発言を追加せずにやり直す */
  const handleRetry = async () => {
    if (!selected || sending) return;
    setError(null);
    setSending(true);
    let accepted = false;
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/issue-dialogue/${selected.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "retry" }),
        },
      );
      const json = (await res.json()) as {
        data: { turn_status?: TurnStatus; messages: IssueMessage[] } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "再試行に失敗しました");
        return;
      }
      if (isAcceptedTurn(res.status, json.data)) {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === selected.id ? { ...r, turn_status: "processing", turn_error: null } : r,
          ),
        );
        accepted = true;
        // AI処理の実体は画面から起動する（サーバーの自己呼び出しは Lambda 凍結で届かない）
        requestTurnStep(`/api/admin/projects/${projectId}/issue-dialogue/${selected.id}/chat`);
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      if (!accepted) setSending(false);
    }
    if (accepted) await awaitTurn(selected.id);
  };

  const handleCommit = async () => {
    if (!selected || committing) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/issue-dialogue/${selected.id}/commit`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        data: { created: number; hypotheses: CommittedHypothesis[] } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "書き出しに失敗しました");
        return;
      }
      const fresh = json.data.hypotheses;
      setCommitted((prev) => [
        ...prev.filter((c) => c.issue_dialogue_id !== selected.id),
        ...fresh,
      ]);
      setRecords((prev) =>
        prev.map((r) =>
          r.id === selected.id ? { ...r, committed_at: new Date().toISOString() } : r,
        ),
      );
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setCommitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この課題仮説設定を削除しますか？（書き出し済みの仮説は残ります）")) return;
    const res = await fetch(`/api/admin/projects/${projectId}/issue-dialogue/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (selectedId === id) setSelectedId(null);
    }
  };

  const handleInherit = async (h: CommittedHypothesis) => {
    const res = await fetch(`/api/admin/projects/${projectId}/logic-model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: h.title,
        challenge: h.root_cause ?? h.description ?? "",
        issue_hypothesis_id: h.id,
      }),
    });
    if (res.ok) {
      router.push(`/projects/${projectId}/logic-model`);
    } else {
      setError("ロジックモデルへの引き継ぎに失敗しました");
    }
  };

  const inputClass =
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
  const inputStyle: React.CSSProperties = {
    background: "var(--bg-input)",
    borderColor: "var(--border)",
  };

  const kpiMode = !!kpiIdParam;
  const kpiModeLabel =
    kpis.find((k) => k.id === kpiIdParam)?.label ?? selected?.kpi_label ?? null;

  const lastAssistant = selected
    ? [...selected.messages].reverse().find((m) => m.role === "assistant")
    : undefined;
  const latestSuggestions = lastAssistant?.suggestions ?? [];

  const selectedCommitted = selected
    ? committed.filter((c) => c.issue_dialogue_id === selected.id)
    : [];

  // ─── 左カラム: 進捗ボード ─────────────────────
  const progressBoard = selected && (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-300">QCストーリー進捗</h2>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={{ background: "#6366f120", color: "#818cf8", border: "1px solid #6366f140" }}
        >
          {ISSUE_STEP_LABEL[selected.current_step]}
        </span>
      </div>

      <StepProgress step={selected.current_step} />

      <div
        className="grid grid-cols-3 gap-2 mt-4 pt-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        {[
          {
            label: "問題",
            // 統合で退役したものは数えない（画面の件数とAIの認識をずらさない）
            value: selected.problems.filter((p) => !p.retired).length,
            color: "#818cf8",
          },
          {
            label: "課題",
            value: selectedActiveProblemIds(selected.problems, selected.selection).length,
            color: "#10b981",
          },
          {
            label: "真因",
            value: selected.root_causes.filter((r) => r.root_cause.trim()).length,
            color: "#f87171",
          },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-lg font-bold font-mono" style={{ color: s.color }}>
              {s.value}
            </p>
            <p className="text-[10px] text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] font-semibold text-slate-400">洗い出した問題</p>
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:brightness-125"
            style={{
              color: showSource ? "#818cf8" : "#94a3b8",
              border: `1px solid ${showSource ? "#818cf850" : "var(--border)"}`,
            }}
            aria-pressed={showSource}
          >
            {showSource ? "出所を隠す" : "出所を表示"}
          </button>
        </div>
        <SelectionInconsistencyNotice
          problems={selected.problems}
          selection={selected.selection}
        />
        <UnresolvedRootCauseNotice
          problems={selected.problems}
          selection={selected.selection}
          rootCauses={selected.root_causes}
          step={selected.current_step}
        />
        <div className="max-h-64 overflow-y-auto pr-1">
          <ProblemList
            problems={selected.problems}
            selection={selected.selection}
            compact={!showSource}
          />
        </div>
      </div>

      {selected.asis_analysis_id ? (
        <p className="text-[10px] text-slate-500 mt-3 leading-snug">
          ✅ 現状整理（SWOT・クロス分析）を根拠に接続済み
        </p>
      ) : (
        <p className="text-[10px] text-amber-500/80 mt-3 leading-snug">
          ⚠ 現状整理が未連携です。先に現状整理を完了すると精度が上がります
        </p>
      )}
    </div>
  );

  // ─── 右カラム: 対話 or 結果 ────────────────────
  const detailPanel =
    selected == null ? null : selected.status === "completed" ? (
      <div>
        <div
          className="rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3"
          style={{ background: "#10b98112", borderColor: "#10b98140" }}
        >
          <p className="text-sm font-medium text-emerald-400">✅ 課題仮説設定が完了しました</p>
          <div className="flex items-center gap-2 shrink-0">
            {selected.kpi_id && (
              <button
                onClick={() => router.push(`/projects/${projectId}/gap-analysis`)}
                className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                style={{ background: "#10b98120", color: "#10b981", border: "1px solid #10b98140" }}
              >
                ← ギャップ分析に戻る
              </button>
            )}
            <button
              onClick={() => handleDelete(selected.id)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{ background: "#ef444418", color: "#ef4444", border: "1px solid #ef444440" }}
            >
              削除
            </button>
          </div>
        </div>
        <ResultView
          record={selected}
          committed={selectedCommitted}
          onCommit={() => void handleCommit()}
          committing={committing}
          onInherit={(h) => void handleInherit(h)}
          canEdit
        />
      </div>
    ) : (
      <div
        className="rounded-xl border flex flex-col"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)", height: 620 }}
      >
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <p className="text-[11px] text-slate-500">
            {ISSUE_STEP_LABEL[selected.current_step]}
          </p>
          {selected.messages.length > 0 && (
            <CopyButton
              variant="outline"
              label="対話全体をコピー"
              text={() =>
                formatTranscript(selected.messages, {
                  title: `課題仮説設定${selected.kpi_label ? ` — ${selected.kpi_label}` : ""}`,
                  stepLabel: (k) => ISSUE_STEP_LABEL[k as IssueStep] ?? k,
                })
              }
            />
          )}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {selected.messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%]">
                <div
                  className="rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed"
                  style={
                    m.role === "user"
                      ? { background: "#6366f1", color: "#fff" }
                      : {
                          background: "var(--bg-secondary)",
                          color: "var(--text-primary)",
                          border: "1px solid var(--border)",
                        }
                  }
                >
                  {m.content}
                  {m.role === "assistant" && (
                    <MessageSources references={m.references} unsourced={m.unsourced} />
                  )}
                </div>
                <div className={`flex mt-0.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <CopyButton
                    text={() => formatMessage(m, (k) => ISSUE_STEP_LABEL[k as IssueStep] ?? k)}
                    title="この発言をコピー"
                  />
                </div>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <AiThinkingIndicator
                label="AIが考えています"
                sub="現状整理・ナレッジ・Webを参照しながら次の問いとヒントを準備しています"
              />
            </div>
          )}
        </div>

        <PermissionGate module="issue_hypothesis" level="edit" projectId={projectId}>
          <div className="border-t p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
            {latestSuggestions.length > 0 && !sending && (
              <div>
                <p className="text-[11px] font-semibold mb-1.5" style={{ color: "#818cf8" }}>
                  💡 回答のヒント — クリックすると入力欄に追加されます
                </p>
                <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {latestSuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setInput((prev) => (prev ? `${prev}\n${s}` : s))}
                      className="text-left text-xs leading-snug px-3 py-2 rounded-lg transition-colors hover:brightness-125"
                      style={{
                        background: "rgba(99,102,241,0.10)",
                        color: "#c7d2fe",
                        border: "1px solid rgba(99,102,241,0.35)",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-slate-500">
              現在: {ISSUE_STEP_LABEL[selected.current_step]}｜
              {ISSUE_STEP_HINT[selected.current_step]}。ヒントには「はい／いいえ＋実情の補足」で
              答えるだけでも構いません。分からない項目は「不明」でOKです。
            </p>
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={2}
                placeholder="回答を入力（Enterで送信 / Shift+Enterで改行）"
                className={inputClass}
                style={{ ...inputStyle, resize: "none" }}
                disabled={sending}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || sending}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 shrink-0"
                style={{ background: "#6366f1" }}
              >
                送信
              </button>
            </div>
          </div>
        </PermissionGate>
      </div>
    );

  const loadingPanel = (
    <div
      className="rounded-xl border p-12 flex flex-col items-center gap-3"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <AiThinkingIndicator
        label="対話を準備しています"
        sub="現状整理の結果と指標の情報を読み込んでいます"
      />
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-xs text-slate-500">{project.title}</p>
            <h1 className="text-xl font-bold text-slate-100">対話型の課題仮説設定</h1>
            <p className="text-[11px] text-slate-500 mt-1 leading-snug">
              目標と現状の差から問題を洗い出し、特に解決すべきもの（課題）を選別して真因に到達します
              （JIS Q 9024:2003 の継続的改善手順に準拠）
            </p>
            {kpiMode && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">対象指標</span>
                <span
                  className="text-sm font-semibold px-3 py-1 rounded-lg"
                  style={{
                    background: "#6366f120",
                    color: "#a5b4fc",
                    border: "1px solid #6366f140",
                  }}
                >
                  📊 {kpiModeLabel ?? "（読み込み中）"}
                </span>
              </div>
            )}
          </div>
          {kpiMode ? (
            <button
              onClick={() => router.push(`/projects/${projectId}/gap-analysis`)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
              style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
            >
              ← ギャップ分析に戻る
            </button>
          ) : (
            <PermissionGate module="issue_hypothesis" level="edit" projectId={projectId}>
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors shrink-0"
                style={{ background: "#6366f1" }}
              >
                + 新しい課題仮説設定
              </button>
            </PermissionGate>
          )}
        </div>

        {error && (
          <div
            className="rounded-lg border px-4 py-2 text-sm mb-4"
            style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
          >
            {error}
            {selected?.turn_status === "error" && !sending && (
              <button
                onClick={() => void handleRetry()}
                className="ml-3 text-xs px-2 py-0.5 rounded border hover:brightness-125"
                style={{ borderColor: "#ef444480" }}
              >
                🔁 AI処理を再試行
              </button>
            )}
            <button
              onClick={() => setError(null)}
              className="ml-3 text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {kpiMode ? (
          <div className="flex gap-4">
            <div className="flex flex-col gap-4" style={{ width: 340, flexShrink: 0 }}>
              {progressBoard}
            </div>
            <div className="flex-1 min-w-0">{selected ? detailPanel : loadingPanel}</div>
          </div>
        ) : records.length === 0 ? (
          <div
            className="rounded-xl border p-12 text-center"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <p className="text-slate-500 text-sm mb-1">課題仮説設定がまだありません</p>
            <p className="text-slate-600 text-xs">
              「新しい課題仮説設定」から、AIとの対話で問題の洗い出し・課題の選別・真因分析を進められます
            </p>
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="flex flex-col gap-4" style={{ width: 340, flexShrink: 0 }}>
              <div
                className="rounded-xl border p-3"
                style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
              >
                <h2 className="text-xs font-semibold text-slate-400 mb-2 px-1">設定一覧</h2>
                <div className="space-y-1.5">
                  {records.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className="w-full text-left rounded-lg px-3 py-2 transition-colors"
                      style={
                        selectedId === r.id
                          ? { background: "#6366f120", border: "1px solid #6366f140" }
                          : { background: "var(--bg-primary)", border: "1px solid var(--border)" }
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-slate-200 truncate">
                          {r.title}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                          style={
                            r.status === "completed"
                              ? { background: "#10b98120", color: "#10b981" }
                              : { background: "#f59e0b20", color: "#f59e0b" }
                          }
                        >
                          {r.status === "completed"
                            ? "完了"
                            : ISSUE_STEP_LABEL[r.current_step]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {progressBoard}
            </div>

            <div className="flex-1 min-w-0">
              {!selected ? (
                <div
                  className="rounded-xl border p-12 text-center"
                  style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
                >
                  <p className="text-slate-500 text-sm">左の一覧から選択してください</p>
                </div>
              ) : (
                detailPanel
              )}
            </div>
          </div>
        )}
      </div>

      {/* 新規作成モーダル */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "#00000080" }}
        >
          <div
            className="rounded-xl border w-full max-w-sm mx-4 p-6 neu-card"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
          >
            <h2 className="text-base font-semibold text-slate-100 mb-1">新しい課題仮説設定</h2>
            <p className="text-xs text-slate-500 mb-4">
              対象のKPIを選ぶと、その指標の現状整理（SWOT・クロス分析）を起点に対話します
            </p>
            <label className="text-xs text-slate-400 mb-1 block">対象KPI</label>
            <select
              value={newKpiId}
              onChange={(e) => setNewKpiId(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">プロジェクト全体</option>
              {kpis.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={creating}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ background: "#6366f1" }}
              >
                {creating ? "作成中..." : "対話を始める"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
