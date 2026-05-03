"use client";

import Link from "next/link";

type Status = "draft" | "active" | "completed" | "archived";
type PdcaStage = "P" | "D" | "C" | "A";

const PDCA_LABEL: Record<PdcaStage, string> = {
  P: "P: 計画中",
  D: "D: 実行中",
  C: "C: 評価中",
  A: "A: 改善中",
};

const PDCA_STYLE: Record<PdcaStage, { bg: string; border: string; color: string }> = {
  P: { bg: "#6366f115", border: "#6366f140", color: "#818cf8" },
  D: { bg: "#06b6d415", border: "#06b6d440", color: "#22d3ee" },
  C: { bg: "#f59e0b15", border: "#f59e0b40", color: "#fbbf24" },
  A: { bg: "#10b98115", border: "#10b98140", color: "#34d399" },
};

const STATUS_LABEL: Record<Status, string> = {
  draft: "計画中",
  active: "実施中",
  completed: "完了",
  archived: "アーカイブ",
};

const STATUS_BADGE: Record<Status, string> = {
  draft: "bg-slate-500/20 text-slate-400 border-slate-500/20",
  active: "bg-indigo-500/20 text-indigo-400 border-indigo-500/20",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/20",
  archived: "bg-amber-500/20 text-amber-400 border-amber-500/20",
};

interface Props {
  id: string;
  title: string;
  description: string;
  status: Status;
  department: string;
  pdcaStage: PdcaStage;
}

export function ProjectCard({ id, title, description, status, department, pdcaStage }: Props) {
  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-3 transition-all duration-200 hover:-translate-y-0.5 cursor-default"
      style={{
        background: "#1a1d27",
        borderColor: "#2a2d3a",
        boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#6366f130";
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 8px 32px rgba(99,102,241,0.12)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#2a2d3a";
        (e.currentTarget as HTMLDivElement).style.boxShadow =
          "0 2px 12px rgba(0,0,0,0.2)";
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-slate-100 text-sm leading-snug line-clamp-2">
          {title}
        </h4>
        <span
          className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap font-medium ${STATUS_BADGE[status]}`}
          style={{ backdropFilter: "blur(4px)" }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {/* PDCAステージバッジ */}
      <div>
        <span
          className="inline-block text-xs px-2.5 py-0.5 rounded-full border font-semibold"
          style={{
            background: PDCA_STYLE[pdcaStage].bg,
            borderColor: PDCA_STYLE[pdcaStage].border,
            color: PDCA_STYLE[pdcaStage].color,
          }}
        >
          {PDCA_LABEL[pdcaStage]}
        </span>
      </div>

      {description && (
        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
          {description}
        </p>
      )}

      <div className="text-xs text-slate-600">{department}</div>

      <div className="mt-auto pt-1">
        <Link
          href={`/projects/${id}`}
          className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
        >
          詳細 →
        </Link>
      </div>
    </div>
  );
}
