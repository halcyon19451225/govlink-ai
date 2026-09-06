export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { normalizeMeasure } from "@/lib/measure/types";
import {
  corpusMeasureFromMeasure,
  corpusEvidenceFromItem,
} from "@/lib/corpus/types";
import {
  contributorKeyOf,
  contentKey,
  isOptedIn,
  upsertCorpusMeasure,
  upsertCorpusEvidence,
} from "@/lib/corpus/server";
import { EFFECT_DIRECTION_META, isEffectDirection } from "@/lib/measure/experimentResult";

type Params = { params: { id: string; measureId: string } };

/**
 * 確定済み施策のコーパスへの供出 — X3
 *
 * 前提（すべて満たさないと供出できない）:
 *  1. 自治体がオプトイン同意済み（corpus_consents.opted_in — 契約に基づきOrdoが設定）
 *  2. 施策が確定済み（status='confirmed' — 担当者確認済みの事実データのみ）
 * 処理:
 *  - 自治体名を「当自治体」へ置換して匿名化（contributor_key はハッシュ）
 *  - KPIは実体参照を外し、人が読める要約（outcome_notes）に落とす
 *  - 昇格済み実験結果は effect_note に要約
 *  - コーパスには status='pending' で入り、Ordo検収を経て参照対象になる
 *  - source_key による冪等 upsert（再供出は内容更新＋検収やり直し）
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  // 施策 → プロジェクト → 自治体
  const project = await queryOne<{ municipality_id: string; municipality_name: string | null }>(
    `SELECT p.municipality_id, m.name AS municipality_name
     FROM projects p LEFT JOIN municipalities m ON m.id = p.municipality_id
     WHERE p.id = $1`,
    [params.id],
  );
  if (!project) {
    return NextResponse.json({ data: null, error: "プロジェクトが見つかりません" }, { status: 404 });
  }

  if (!(await isOptedIn(project.municipality_id))) {
    return NextResponse.json(
      {
        data: null,
        error:
          "この自治体は匿名化データの横断利用（コーパス）に同意していません。同意は契約に基づき運営側で設定されます",
      },
      { status: 403 },
    );
  }

  const raw = await queryOne<Record<string, unknown>>(
    `SELECT * FROM measure_designs WHERE id = $1 AND project_id = $2`,
    [params.measureId, params.id],
  );
  if (!raw) {
    return NextResponse.json({ data: null, error: "施策が見つかりません" }, { status: 404 });
  }
  const measure = normalizeMeasure(raw);
  if (measure.status !== "confirmed") {
    return NextResponse.json(
      { data: null, error: "供出できるのは確定済みの施策だけです（担当者確認済みの事実データのみをコーパスに入れる方針）" },
      { status: 422 },
    );
  }

  // KPI要約（実体参照を外す）
  const kpiIds = [...measure.kpi_ids_initial, ...measure.kpi_ids_intermediate];
  const kpiNotes: string[] = [];
  if (kpiIds.length > 0) {
    const kpis = await query<{
      id: string;
      label: string;
      unit: string | null;
      target: number | null;
    }>(
      `SELECT id, label, unit, target::float AS target FROM kpis WHERE id = ANY($1::uuid[])`,
      [kpiIds],
    );
    const byId = new Map(kpis.map((k) => [k.id, k]));
    for (const id of measure.kpi_ids_initial) {
      const k = byId.get(id);
      if (k) kpiNotes.push(`短期: ${k.label}${k.target != null ? `（目標${k.target}${k.unit ?? ""}）` : ""}`);
    }
    for (const id of measure.kpi_ids_intermediate) {
      const k = byId.get(id);
      if (k) kpiNotes.push(`中間: ${k.label}${k.target != null ? `（目標${k.target}${k.unit ?? ""}）` : ""}`);
    }
  }

  // 昇格済み実験結果 → 実績効果の要約
  const results = await query<{
    result_summary: string;
    effect_direction: string;
    evidence_level: number | null;
  }>(
    `SELECT result_summary, effect_direction, evidence_level
     FROM experiment_results
     WHERE measure_design_id = $1 AND promoted_at IS NOT NULL
     ORDER BY promoted_at DESC LIMIT 3`,
    [params.measureId],
  );
  const effectNote =
    results.length > 0
      ? results
          .map((r) => {
            const dir = isEffectDirection(r.effect_direction)
              ? EFFECT_DIRECTION_META[r.effect_direction].label
              : "判定できず";
            return `【${dir}${r.evidence_level ? `・Lv${r.evidence_level}` : ""}】${r.result_summary}`;
          })
          .join(" / ")
      : null;

  const municipalityName = project.municipality_name;
  const cm = corpusMeasureFromMeasure(measure, {
    municipalityName,
    kpiNotes,
    effectNote,
  });

  const contributor = contributorKeyOf(project.municipality_id);
  const measureRowId = await upsertCorpusMeasure(cm, {
    source_kind: "measure_design",
    source_key: `md:${params.measureId}`,
    contributor_key: contributor,
  });

  // エビデンス項目も横断検索できるよう個別行にする
  // （自プロジェクト実験由来は experiment_result として区別）
  let evidenceCount = 0;
  for (const item of measure.evidence_items) {
    const ce = corpusEvidenceFromItem(item, { municipalityName });
    const kind = item.source.startsWith("Coe実験記録") ? "experiment_result" : "evidence_item";
    const key = contentKey(`mdev:${params.measureId}`, item.title, item.source);
    const id = await upsertCorpusEvidence(ce, {
      source_kind: kind,
      source_key: key,
      contributor_key: contributor,
    });
    if (id) evidenceCount++;
  }

  return NextResponse.json({
    data: {
      contributed: measureRowId != null,
      evidence_contributed: evidenceCount,
      status: "pending",
      note: "Ordo運営の検収（承認）を経てコーパスの参照対象になります",
    },
    error: null,
  });
}
