export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { recordArtifact, resolveArtifactIds } from "@/lib/modules/recordArtifact";
import { markGroundingAdopted } from "@/lib/corpus/retrieval";
import type {
  ApproachCost,
  ApproachEvidence,
  ApproachExperiment,
  ApproachIndicators,
  ApproachItem,
  ExperimentPlan,
  KpiDraft,
  MeasureMessage,
  MeasureStep,
} from "@/lib/measure/types";
import { measureCommitGaps, describeMeasureGaps, activeApproaches } from "@/lib/measure/types";

type Params = { params: { id: string; dialogueId: string } };

// 対話の成果（アプローチ・エビデンス・実験設計・指標・コスト）を measure_designs へ書き出す — E2〜E4
//
// 指標のアウトカムKPIは kpis テーブルの実体に解決する（承認済み方針: 自動作成＋既存選択）。
// 短期KPIには contributes_to_kpi_id で中間KPIへの寄与を張り、
// 既存のアウトカム・スコアボード／到達度計算／整合検査がそのまま効くようにする。
//
// 1アプローチ = 1施策（draft）。
// 再コミット時は、対話側に控えた measure_design_id を使って同じ行を更新する
// （行を作り直さない。E3以降で実験設計・指標が積まれる行を消さないため）。

interface DialogueRow {
  id: string;
  issue_hypothesis_id: string | null;
  current_step: MeasureStep;
  messages: MeasureMessage[];
  approaches: ApproachItem[];
  evidence: ApproachEvidence[];
  experiments: ApproachExperiment[];
  indicators: ApproachIndicators[];
  costs: ApproachCost[];
  committed_at: string | null;
  hyp_root_cause: string | null;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "measure_design", "edit");
  if (deny) return deny;

  const row = await queryOne<DialogueRow>(
    `SELECT d.id, d.issue_hypothesis_id, d.current_step, d.messages,
            d.approaches, d.evidence, d.experiments, d.indicators, d.costs,
            d.committed_at::text,
            h.root_cause AS hyp_root_cause
     FROM measure_dialogues d
     LEFT JOIN issue_hypotheses h ON h.id = d.issue_hypothesis_id
     WHERE d.id = $1 AND d.project_id = $2`,
    [params.dialogueId, params.id],
  );

  if (!row) {
    return NextResponse.json({ data: null, error: "対話が見つかりません" }, { status: 404 });
  }
  // 取り下げたアプローチは書き出さない（行は残るが確定の対象から外れる）
  const liveApproaches = activeApproaches(row.approaches);
  if (liveApproaches.length === 0) {
    return NextResponse.json(
      { data: null, error: "書き出せるアプローチがまだありません。対話でアプローチを固めてください" },
      { status: 422 },
    );
  }

  // 区画の欠けたデータセットを書き出させない。
  // 下流（ロジックモデルの活動・産出・アウトカム、C評価の効率性、A改善）は
  // 揃っている前提で動くため、空のまま流すとKPIの無い活動が並ぶ（2026-08-31）。
  const gaps = measureCommitGaps(row);
  if (gaps.length > 0) {
    return NextResponse.json(
      {
        data: null,
        error: `施策データセットに未記入の区画があります — ${describeMeasureGaps(gaps)}。対話で埋めてから書き出してください`,
        gaps,
      },
      { status: 422 },
    );
  }

  const evidenceByApproach = new Map(row.evidence.map((e) => [e.approach_id, e]));
  const experimentByApproach = new Map(row.experiments.map((e) => [e.approach_id, e]));
  const indicatorsByApproach = new Map(row.indicators.map((e) => [e.approach_id, e]));
  const costByApproach = new Map(row.costs.map((e) => [e.approach_id, e]));

  const result = await transaction(async (client) => {
    let created = 0;
    let updated = 0;
    let kpisCreated = 0;
    const nextApproaches: ApproachItem[] = [];

    /**
     * KPI案を実体（kpis.id）に解決する — 承認済み方針「自動作成＋既存選択」。
     *
     * 冪等性: 再コミットで同じKPIを二重に作らないよう、
     *   (1) existing_kpi_id が有効ならそれを使う
     *   (2) 同名（大文字小文字無視）のKPIが既にあればそれを使う
     *   (3) どちらも無ければ新規作成する
     * 新規作成時は baseline を基準値と現在値の初期値に入れ、
     * 達成条件・期限・指標タイプ（三層）も同時に登録する。
     */
    const resolveKpi = async (
      draft: KpiDraft,
      indicatorType: "outcome_initial" | "outcome_intermediate",
      contributesTo: string | null,
    ): Promise<string | null> => {
      if (draft.existing_kpi_id) {
        const ex = await client.query<{ id: string }>(
          `SELECT id FROM kpis WHERE id = $1 AND project_id = $2`,
          [draft.existing_kpi_id, params.id],
        );
        if (ex.rows[0]) return ex.rows[0].id;
      }
      const label = draft.label.trim();
      if (!label) return null;

      const byLabel = await client.query<{ id: string }>(
        `SELECT id FROM kpis WHERE project_id = $1 AND lower(label) = lower($2) LIMIT 1`,
        [params.id, label],
      );
      if (byLabel.rows[0]) return byLabel.rows[0].id;

      const ins = await client.query<{ id: string }>(
        `INSERT INTO kpis
           (project_id, label, unit, target, current,
            baseline_value, achievement_condition, target_deadline,
            indicator_type, contributes_to_kpi_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          params.id,
          label,
          draft.unit ?? "",
          draft.target ?? 0,
          draft.baseline ?? 0,
          draft.baseline ?? null,
          draft.condition ?? "gte",
          draft.deadline ?? null,
          indicatorType,
          contributesTo,
        ],
      );
      const id = ins.rows[0]?.id ?? null;
      if (id) kpisCreated++;
      return id;
    };

    for (let i = 0; i < liveApproaches.length; i++) {
      const a = liveApproaches[i] as ApproachItem;
      const ev = evidenceByApproach.get(a.id) ?? null;
      const evidenceStatus = ev?.status ?? "none";
      const evidenceItems = ev?.items ?? [];
      const rootCause = a.root_cause || row.hyp_root_cause || null;
      // 実験設計（E3）。approach_id を落とし、measure_designs.experiment の形にする
      const exp = experimentByApproach.get(a.id) ?? null;
      const experimentPlan: ExperimentPlan | null = exp
        ? // eslint-disable-next-line @typescript-eslint/no-unused-vars
          (({ approach_id: _aid, ...plan }) => plan)(exp)
        : null;

      // 指標（E4）。アウトカムKPIは実体に解決し、短期→中間の寄与を張る
      const ind = indicatorsByApproach.get(a.id) ?? null;
      const kpiIdsInitial: string[] = [];
      const kpiIdsIntermediate: string[] = [];
      if (ind) {
        for (const draft of ind.outcome_intermediate) {
          const id = await resolveKpi(draft, "outcome_intermediate", null);
          if (id && !kpiIdsIntermediate.includes(id)) kpiIdsIntermediate.push(id);
        }
        const contributesTo = kpiIdsIntermediate[0] ?? null;
        for (const draft of ind.outcome_initial) {
          const id = await resolveKpi(draft, "outcome_initial", contributesTo);
          if (id && !kpiIdsInitial.includes(id)) kpiIdsInitial.push(id);
        }
      }
      const structureJson = ind
        ? JSON.stringify(ind.structure.map((t, j) => ({ id: `st_${j}`, text: t, kpi_id: null })))
        : null;
      const processJson = ind
        ? JSON.stringify(ind.process.map((t, j) => ({ id: `pr_${j}`, text: t, kpi_id: null })))
        : null;

      // コスト（E4）
      const cost = costByApproach.get(a.id) ?? null;

      // 既に書き出し済みなら同じ行を更新する（行の作り直しはしない）
      let targetId: string | null = null;
      if (a.measure_design_id) {
        const exists = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM measure_designs WHERE id = $1 AND project_id = $2`,
          [a.measure_design_id, params.id],
        );
        targetId = exists.rows[0]?.id ?? null;
        // 確定済みの施策は対話からの再書き出しで上書きしない
        // （担当者が確定した内容を、後続の対話が黙って書き換えないため）
        if (exists.rows[0]?.status === "confirmed") {
          nextApproaches.push(a);
          continue;
        }
      }

      if (targetId) {
        await client.query(
          `UPDATE measure_designs
           SET title = $1, approach = $2, root_cause_snapshot = $3,
               target_population = NULLIF($4, ''), intervention = NULLIF($5, ''),
               evidence_status = $6, evidence_items = $7::jsonb,
               -- 対話に無い区画は既存の内容を残す（黙って消さない）
               experiment = COALESCE($8::jsonb, experiment),
               structure_indicators = COALESCE($9::jsonb, structure_indicators),
               process_indicators = COALESCE($10::jsonb, process_indicators),
               kpi_ids_initial = CASE WHEN $11::uuid[] IS NULL THEN kpi_ids_initial ELSE $11::uuid[] END,
               kpi_ids_intermediate = CASE WHEN $12::uuid[] IS NULL THEN kpi_ids_intermediate ELSE $12::uuid[] END,
               total_budget = COALESCE($13, total_budget),
               unit_cost = COALESCE($14, unit_cost),
               cost_per_outcome_note = COALESCE(NULLIF($15, ''), cost_per_outcome_note),
               funding = COALESCE(NULLIF($16, ''), funding),
               budget_breakdown = COALESCE($21::jsonb, budget_breakdown),
               issue_hypothesis_id = $17, measure_dialogue_id = $18
           WHERE id = $19 AND project_id = $20`,
          [
            a.measure_title,
            a.approach,
            rootCause,
            a.target,
            a.intervention,
            evidenceStatus,
            JSON.stringify(evidenceItems),
            experimentPlan ? JSON.stringify(experimentPlan) : null,
            structureJson,
            processJson,
            ind ? kpiIdsInitial : null,
            ind ? kpiIdsIntermediate : null,
            cost?.total_budget ?? null,
            cost?.unit_cost ?? null,
            cost?.cost_per_outcome_note ?? "",
            cost?.funding ?? "",
            row.issue_hypothesis_id,
            row.id,
            targetId,
            params.id,
            cost?.breakdown && cost.breakdown.length > 0
              ? JSON.stringify(cost.breakdown)
              : null,
          ],
        );
        updated++;
        nextApproaches.push(a);
        continue;
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO measure_designs
           (project_id, title, approach, root_cause_snapshot,
            target_population, intervention,
            evidence_status, evidence_items, experiment,
            structure_indicators, process_indicators,
            kpi_ids_initial, kpi_ids_intermediate,
            total_budget, unit_cost, cost_per_outcome_note, funding,
            budget_breakdown,
            issue_hypothesis_id, measure_dialogue_id, sort_order)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, $8::jsonb, $9::jsonb,
                 COALESCE($10::jsonb, '[]'::jsonb), COALESCE($11::jsonb, '[]'::jsonb),
                 COALESCE($12::uuid[], '{}'::uuid[]), COALESCE($13::uuid[], '{}'::uuid[]),
                 $14, $15, NULLIF($16, ''), NULLIF($17, ''),
                 COALESCE($21::jsonb, '[]'::jsonb),
                 $18, $19,
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 + $20
                  FROM measure_designs WHERE project_id = $1))
         RETURNING id`,
        [
          params.id,
          a.measure_title,
          a.approach,
          rootCause,
          a.target,
          a.intervention,
          evidenceStatus,
          JSON.stringify(evidenceItems),
          experimentPlan ? JSON.stringify(experimentPlan) : null,
          structureJson,
          processJson,
          ind ? kpiIdsInitial : null,
          ind ? kpiIdsIntermediate : null,
          cost?.total_budget ?? null,
          cost?.unit_cost ?? null,
          cost?.cost_per_outcome_note ?? "",
          cost?.funding ?? "",
          row.issue_hypothesis_id,
          row.id,
          i,
          cost?.breakdown && cost.breakdown.length > 0
            ? JSON.stringify(cost.breakdown)
            : null,
        ],
      );
      const newId = inserted.rows[0]?.id ?? null;
      if (newId) {
        created++;
        nextApproaches.push({ ...a, measure_design_id: newId });

        // リネージ: 課題仮説 → 施策
        const sourceIds = await resolveArtifactIds(params.id, "issue_hypothesis", [
          row.issue_hypothesis_id,
        ]).catch(() => [] as string[]);
        await recordArtifact(
          {
            projectId: params.id,
            moduleId: "measure_design",
            artifactType: "measure_dataset",
            artifactRecordId: newId,
            sourceArtifactIds: sourceIds,
            derivationNote: `施策構築対話(${row.id})から書き出し: ${a.measure_title}`,
          },
          client,
        ).catch((e) => console.error("recordArtifact(measure_design commit) 失敗:", e));
      } else {
        nextApproaches.push(a);
      }
    }

    // 対話側に書き出し先IDを控え、committed_at を刻む
    await client.query(
      `UPDATE measure_dialogues
       SET approaches = $1::jsonb, committed_at = now()
       WHERE id = $2 AND project_id = $3`,
      [JSON.stringify(nextApproaches), row.id, params.id],
    );

    return { created, updated, kpis_created: kpisCreated };
  });

  // 粗い採択記録（X4）: コーパス接地した対話が書き出しまで到達した
  if (result.created + result.updated > 0) {
    await markGroundingAdopted(params.dialogueId);
  }

  return NextResponse.json({ data: result, error: null });
}
