export const dynamic = 'force-dynamic'

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import TemplatesClient from "./TemplatesClient";

export interface PlanModule {
  id: string;
  display_name: string;
  description: string | null;
  plan_types: string[];
  depends_on: string[];
  sort_order: number;
}

export interface PlanTemplate {
  id: string;
  name: string;
  plan_type: string;
  description: string | null;
  plan_period_years: number;
  module_config: Record<string, { enabled: boolean }>;
  is_system_template: boolean;
  is_public: boolean;
  cycles: Array<{
    id: string;
    name: string;
    cycle_type: string;
    phase: string;
    recurrence: string;
    sort_order: number;
  }>;
}

export default async function TemplatesPage() {
  const session = await getServerSession(authOptions);
  const municipalityId = session?.user?.municipalityId ?? null;

  let modules: PlanModule[] = [];
  let templates: PlanTemplate[] = [];
  let dbError: string | null = null;

  try {
    [modules, templates] = await Promise.all([
      query<PlanModule>(
        `SELECT id, display_name, description, plan_types, depends_on, sort_order
         FROM plan_modules ORDER BY sort_order`,
      ),
      query<PlanTemplate>(
        `SELECT pt.id, pt.name, pt.plan_type, pt.description, pt.plan_period_years,
                pt.module_config, pt.is_system_template, pt.is_public,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'id', pcd.id, 'name', pcd.name, 'cycle_type', pcd.cycle_type,
                      'phase', pcd.phase, 'recurrence', pcd.recurrence,
                      'sort_order', pcd.sort_order
                    ) ORDER BY pcd.sort_order
                  ) FILTER (WHERE pcd.id IS NOT NULL),
                  '[]'::json
                ) AS cycles
         FROM plan_templates pt
         LEFT JOIN pdca_cycle_defs pcd ON pcd.template_id = pt.id
         WHERE pt.is_system_template = true
            OR pt.is_public = true
            OR ($1::uuid IS NOT NULL AND pt.created_by = $1::uuid)
         GROUP BY pt.id
         ORDER BY pt.is_system_template DESC, pt.name`,
        [municipalityId],
      ),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("plan_modules") || msg.includes("does not exist")) {
      dbError = "DBマイグレーションが未適用です。010_care_plan_suite.sql と 011_system_templates.sql を実行してください。";
    } else {
      dbError = `DB接続エラー: ${msg.slice(0, 120)}`;
    }
  }

  return <TemplatesClient modules={modules} templates={templates} municipalityId={municipalityId} dbError={dbError} />;
}
