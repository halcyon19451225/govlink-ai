export const dynamic = 'force-dynamic'

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import ModuleGraphClient from "./ModuleGraphClient";
import CloneNextPeriodButton from "@/components/plan/CloneNextPeriodButton";
import { assertProjectPage } from "@/lib/tenant-page";

interface PlanModule {
  id: string;
  display_name: string;
  description: string | null;
  depends_on: string[];
}

export default async function ModulesSettingsPage({
  params,
}: {
  params: { id: string };
}) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const project = await queryOne<{
    id: string;
    title: string;
    plan_start_date: string | null;
    plan_end_date: string | null;
  }>(
    `SELECT id, title,
            to_char(plan_start_date, 'YYYY-MM-DD') AS plan_start_date,
            to_char(plan_end_date, 'YYYY-MM-DD') AS plan_end_date
     FROM projects WHERE id = $1`,
    [params.id],
  );
  if (!project) notFound();

  const projectModules = await query<{ module_id: string; is_enabled: boolean }>(
    "SELECT module_id, is_enabled FROM project_module_configs WHERE project_id = $1",
    [params.id],
  );

  const allModules = await query<PlanModule>(
    "SELECT id, display_name, description, depends_on FROM plan_modules ORDER BY sort_order",
    [],
  );

  const rules = await query<{
    module_a: string;
    module_b: string;
    is_blocking: boolean;
    warning_message: string;
  }>(
    "SELECT module_a, module_b, is_blocking, warning_message FROM module_incompatibility_rules",
    [],
  );

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100">モジュール設定</h2>
          <p className="text-sm text-slate-400 mt-1">
            このプロジェクトで使用するモジュールと依存関係を確認できます。
          </p>
        </div>
        {/* PL1 P①: 次期計画のたたき台作成（前期計画の複製） */}
        <CloneNextPeriodButton
          projectId={project.id}
          sourceTitle={project.title}
          planStart={project.plan_start_date}
          planEnd={project.plan_end_date}
        />
      </div>
      <ModuleGraphClient
        projectModules={projectModules}
        allModules={allModules}
        projectId={params.id}
        rules={rules}
      />
    </div>
  );
}
