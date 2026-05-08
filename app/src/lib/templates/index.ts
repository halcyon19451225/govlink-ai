import { query } from "@/lib/db";

export interface PdcaCheckpointDef {
  id: string;
  cycle_id: string;
  name: string;
  description: string | null;
  plan_year: number;
  month_start: number;
  month_end: number | null;
  modules_involved: string[];
  sort_order: number;
}

export interface PdcaCycleDef {
  id: string;
  template_id: string;
  name: string;
  cycle_type: string;
  phase: string;
  recurrence: string;
  sort_order: number;
  checkpoints: PdcaCheckpointDef[];
}

export interface TemplateWithCycles {
  id: string;
  name: string;
  plan_type: string;
  description: string | null;
  plan_period_years: number;
  module_config: Record<string, { enabled: boolean }>;
  is_system_template: boolean;
  cycles: PdcaCycleDef[];
}

export async function getTemplateWithCycles(templateId: string): Promise<TemplateWithCycles | null> {
  const templates = await query<{
    id: string; name: string; plan_type: string; description: string | null;
    plan_period_years: number; module_config: Record<string, { enabled: boolean }>;
    is_system_template: boolean;
  }>(
    `SELECT id, name, plan_type, description, plan_period_years,
            module_config, is_system_template
     FROM plan_templates WHERE id = $1`,
    [templateId],
  );
  const tmpl = templates[0];
  if (!tmpl) return null;

  const cycles = await query<{
    id: string; template_id: string; name: string; cycle_type: string;
    phase: string; recurrence: string; sort_order: number;
  }>(
    `SELECT id, template_id, name, cycle_type, phase, recurrence, sort_order
     FROM pdca_cycle_defs WHERE template_id = $1 ORDER BY sort_order`,
    [templateId],
  );

  const checkpoints = await query<PdcaCheckpointDef>(
    `SELECT id, cycle_id, name, description, plan_year, month_start, month_end,
            modules_involved, sort_order
     FROM pdca_checkpoint_defs
     WHERE cycle_id = ANY($1::uuid[])
     ORDER BY plan_year, month_start, sort_order`,
    [cycles.map((c) => c.id)],
  );

  return {
    ...tmpl,
    cycles: cycles.map((c) => ({
      ...c,
      checkpoints: checkpoints.filter((cp) => cp.cycle_id === c.id),
    })),
  };
}

// plan_year=0 は策定フェーズ（計画開始前）、1〜N は計画年度
export function calculateCheckpointDate(
  planStartDate: Date,
  planYear: number,
  monthStart: number,
): Date {
  const baseYear = planStartDate.getFullYear() + (planYear > 0 ? planYear - 1 : -1);
  return new Date(baseYear, monthStart - 1, 1);
}

export async function instantiateTemplate(
  templateId: string,
  projectId: string,
  planStartDate: Date,
): Promise<void> {
  const tmpl = await getTemplateWithCycles(templateId);
  if (!tmpl) throw new Error(`テンプレートが見つかりません: ${templateId}`);

  // module_config から有効モジュールを project_module_configs に挿入
  const enabledModules = Object.entries(tmpl.module_config)
    .filter(([, cfg]) => cfg.enabled)
    .map(([moduleId]) => moduleId);

  for (const moduleId of enabledModules) {
    await query(
      `INSERT INTO project_module_configs (project_id, module_id, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (project_id, module_id) DO NOTHING`,
      [projectId, moduleId],
    );
  }

  // チェックポイント定義から project_pdca_checkpoints を生成
  for (const cycle of tmpl.cycles) {
    for (const cp of cycle.checkpoints) {
      const scheduledDate = calculateCheckpointDate(planStartDate, cp.plan_year, cp.month_start);
      await query(
        `INSERT INTO project_pdca_checkpoints
           (project_id, checkpoint_def_id, scheduled_date, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT DO NOTHING`,
        [projectId, cp.id, scheduledDate.toISOString().slice(0, 10)],
      );
    }
  }
}
