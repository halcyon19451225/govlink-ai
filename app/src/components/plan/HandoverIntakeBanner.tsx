"use client";

/**
 * 「📦 前期からの引き継ぎがあります」バナー — PL1 P①→P②の入口
 * 新計画（複製先）のダッシュボードに表示。finalized な引き継ぎが
 * この計画に結線されているときだけ出る（consumed 後は消える）。
 */

import { useEffect, useState } from "react";
import Link from "next/link";

export default function HandoverIntakeBanner({ projectId }: { projectId: string }) {
  const [handover, setHandover] = useState<{ title: string; source_project_title: string; status: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/projects/${projectId}/handover-intake`)
      .then((r) => r.json())
      .then((json: { data: { handover: { title: string; source_project_title: string; status: string } | null } | null }) => {
        if (!cancelled) setHandover(json.data?.handover ?? null);
      })
      .catch(() => {
        if (!cancelled) setHandover(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!handover || handover.status !== "finalized") return null;

  return (
    <div
      className="rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-3"
      style={{ background: "#6366f118", border: "1px solid #6366f150" }}
    >
      <span className="text-sm" style={{ color: "var(--text-primary)" }}>
        📦 前期計画「{handover.source_project_title}」からの引き継ぎがあります（{handover.title}）
      </span>
      <Link
        href={`/projects/${projectId}/handover-intake`}
        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
        style={{ background: "#6366f1" }}
      >
        取り込みへ →
      </Link>
    </div>
  );
}
