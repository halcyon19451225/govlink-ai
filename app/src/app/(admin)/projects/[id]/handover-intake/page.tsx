export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import HandoverIntakeClient from "./HandoverIntakeClient";
import { assertProjectPage } from "@/lib/tenant-page";

/**
 * 前期報告書・引き継ぎの取り込み — PL1 P②
 * 入口はダッシュボードの「📦 前期からの引き継ぎがあります」バナー（P①の複製後に出る）。
 */
export default async function HandoverIntakePage({ params }: { params: { id: string } }) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          📦 前期からの引き継ぎ取り込み
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          {project.title} — 前期の未達アウトカム・改善アクション・真因を、この計画のたたき台へ反映します
        </p>
      </div>
      <HandoverIntakeClient projectId={project.id} />
    </div>
  );
}
