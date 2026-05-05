export const dynamic = 'force-dynamic'

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import TemplatesClient from "./TemplatesClient";

interface Template {
  id: string;
  name: string;
  category: string;
  legal_basis: string | null;
  plan_period_years: number | null;
  is_composite: boolean;
  description: string | null;
  is_system: boolean;
  shared_by_municipality_id: string | null;
  kpi_suggestions: Array<{
    id: string;
    label: string;
    unit: string | null;
    indicator_type: string;
    sort_order: number;
  }>;
}

export default async function TemplatesPage() {
  const session = await getServerSession(authOptions);
  const municipalityId = session?.user?.municipalityId ?? null;

  const templates = await query<Template>(
    `SELECT pt.id, pt.name, pt.category, pt.legal_basis, pt.plan_period_years,
            pt.is_composite, pt.description, pt.is_system, pt.shared_by_municipality_id,
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
        OR ($1::uuid IS NOT NULL AND pt.shared_by_municipality_id = $1::uuid)
     GROUP BY pt.id
     ORDER BY pt.is_system DESC, pt.category, pt.name`,
    [municipalityId],
  );

  return <TemplatesClient templates={templates} municipalityId={municipalityId} />;
}
