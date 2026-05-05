export const dynamic = 'force-dynamic'

import { query } from "@/lib/db";
import NewProjectWizard from "./NewProjectWizard";

interface Template {
  id: string;
  name: string;
  category: string;
  legal_basis: string | null;
  plan_period_years: number | null;
  is_composite: boolean;
  description: string | null;
  is_system: boolean;
  kpi_suggestions: Array<{
    id: string;
    label: string;
    unit: string | null;
    indicator_type: string;
    sort_order: number;
  }>;
}

export default async function NewProjectPage() {
  const templates = await query<Template>(
    `SELECT pt.id, pt.name, pt.category, pt.legal_basis, pt.plan_period_years,
            pt.is_composite, pt.description, pt.is_system,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', tks.id, 'label', tks.label, 'unit', tks.unit,
                  'indicator_type', tks.indicator_type, 'sort_order', tks.sort_order
                ) ORDER BY tks.sort_order
              ) FILTER (WHERE tks.id IS NOT NULL),
              '[]'::json
            ) AS kpi_suggestions
     FROM plan_templates pt
     LEFT JOIN template_kpi_suggestions tks ON tks.template_id = pt.id
     WHERE pt.is_system = true
     GROUP BY pt.id
     ORDER BY pt.is_system DESC, pt.category, pt.name`,
  );

  return <NewProjectWizard templates={templates} />;
}
