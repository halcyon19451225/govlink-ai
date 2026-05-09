export const dynamic = 'force-dynamic'

import { query } from "@/lib/db";
import NewProjectWizard from "./NewProjectWizard";
import type { TemplateWithCycles } from "@/lib/templates";

interface PlanModule {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
}

type PlanTemplate = TemplateWithCycles & { is_public?: boolean };

export default async function NewProjectPage() {
  const templates = await query<PlanTemplate>(
    `SELECT pt.id, pt.name, pt.plan_type, pt.description, pt.plan_period_years,
            pt.module_config, pt.is_system_template,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', pcd.id,
                  'template_id', pcd.template_id,
                  'name', pcd.name,
                  'cycle_type', pcd.cycle_type,
                  'phase', pcd.phase,
                  'recurrence', pcd.recurrence,
                  'sort_order', pcd.sort_order,
                  'checkpoints', '[]'::json
                ) ORDER BY pcd.sort_order
              ) FILTER (WHERE pcd.id IS NOT NULL),
              '[]'::json
            ) AS cycles
     FROM plan_templates pt
     LEFT JOIN pdca_cycle_defs pcd ON pcd.template_id = pt.id
     WHERE pt.is_system_template = true OR pt.is_public = true
     GROUP BY pt.id
     ORDER BY pt.is_system_template DESC, pt.name`,
  );

  const modules = await query<PlanModule>(
    `SELECT id, name, description, sort_order
     FROM plan_modules
     ORDER BY sort_order`,
  ).catch(() => [] as PlanModule[]);

  return <NewProjectWizard templates={templates} modules={modules} />;
}
