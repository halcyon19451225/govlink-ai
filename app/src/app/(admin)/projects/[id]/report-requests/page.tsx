export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import ReportRequestsClient from "./ReportRequestsClient";

/**
 * 実績報告依頼 — S2 C①（サイドバーC区分「📮 実績報告依頼」）
 * 依頼の作成（AI設問組成）→ 送信（トークンURL発行）→ 回答状況ボード →
 * 受領 → KPI実績の kpi_reports 取り込み。
 */
export default async function ReportRequestsPage({ params }: { params: { id: string } }) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const measures = await query<{ id: string; title: string; owner_department: string | null; status: string }>(
    `SELECT id, title, owner_department, status FROM measure_designs
     WHERE project_id = $1 ORDER BY sort_order, created_at LIMIT 50`,
    [params.id],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          📮 実績報告依頼
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          {project.title} — 施策の担当者・委託事業者に実績報告を依頼し、回答をKPI報告へ取り込みます（回答はログイン不要のトークンURL）
        </p>
      </div>
      <ReportRequestsClient projectId={project.id} measures={measures} />
    </div>
  );
}
