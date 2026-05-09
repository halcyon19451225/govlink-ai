export const dynamic = 'force-dynamic'

import { notFound } from "next/navigation";
import { query, queryOne } from "@/lib/db";
import ModuleGraphClient from "./ModuleGraphClient";

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
  const project = await queryOne<{ id: string }>(
    "SELECT id FROM projects WHERE id = $1",
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
      <div>
        <h2 className="text-xl font-bold text-slate-100">モジュール設定</h2>
        <p className="text-sm text-slate-400 mt-1">
          このプロジェクトで使用するモジュールと依存関係を確認できます。
        </p>
      </div>
      <ModuleGraphClient
        projectModules={projectModules}
        allModules={allModules}
        rules={rules}
      />
    </div>
  );
}
