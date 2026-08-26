export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import DocumentTabs from "./DocumentTabs";

/**
 * 計画書・評価報告書の調製 — PL2 P③ / PL3 A①
 * 定型章の下書き生成 → 章ごとの編集・ロック・AIリライト → 確定 → 出力。
 * 計画書: docx（本編・簡易版・概要版）。評価報告書: docx＋印刷ビュー（PDF保存）。
 * 数値の表は出力時に実データから自動挿入。
 */
export default async function PlanDocumentPage({ params }: { params: { id: string } }) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          📄 計画書の調製
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          {project.title} — 実データから章立てを起こし、編集・確定して出力します（計画書=docx3体裁 / 評価報告書=docx＋印刷）
        </p>
      </div>
      <DocumentTabs projectId={project.id} projectTitle={project.title} />
    </div>
  );
}
