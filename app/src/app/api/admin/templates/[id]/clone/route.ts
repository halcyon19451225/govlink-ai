export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { getTemplateWithCycles } from "@/lib/templates";

type Params = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const municipalityId = session.user?.municipalityId;
  if (!municipalityId) {
    return NextResponse.json({ data: null, error: "自治体情報が取得できません" }, { status: 400 });
  }

  const source = await getTemplateWithCycles(params.id);
  if (!source) {
    return NextResponse.json({ data: null, error: "テンプレートが見つかりません" }, { status: 404 });
  }

  const newTemplateId = await transaction(async (client) => {
    const tmplResult = await client.query<{ id: string }>(
      `INSERT INTO plan_templates
         (name, plan_type, description, plan_period_years, module_config,
          is_system_template, is_public, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, false, false, $6)
       RETURNING id`,
      [
        `（コピー）${source.name}`,
        source.plan_type,
        source.description,
        source.plan_period_years,
        JSON.stringify(source.module_config),
        municipalityId,
      ],
    );
    const templateId = tmplResult.rows[0]!.id;

    for (const cycle of source.cycles) {
      const cycleResult = await client.query<{ id: string }>(
        `INSERT INTO pdca_cycle_defs
           (template_id, name, cycle_type, phase, recurrence, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [templateId, cycle.name, cycle.cycle_type, cycle.phase, cycle.recurrence, cycle.sort_order],
      );
      const newCycleId = cycleResult.rows[0]!.id;

      for (const cp of cycle.checkpoints) {
        await client.query(
          `INSERT INTO pdca_checkpoint_defs
             (cycle_id, name, description, plan_year, month_start, month_end,
              evaluation_tiers, modules_involved, qc_step, instructions, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            newCycleId,
            cp.name,
            cp.description,
            cp.plan_year,
            cp.month_start,
            cp.month_end,
            cp.evaluation_tiers,
            cp.modules_involved,
            cp.qc_step,
            cp.instructions,
            cp.sort_order,
          ],
        );
      }
    }

    return templateId;
  });

  return NextResponse.json({ data: { id: newTemplateId }, error: null }, { status: 201 });
}
