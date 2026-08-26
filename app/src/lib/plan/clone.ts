/**
 * 次期計画のたたき台作成（前期計画の複製）— PL1 P①
 *
 * ── 複製の範囲（設計 第2部 P① — たたき台=枠。実績・過程は持ち込まない）──
 *  複製する: プロジェクト基本情報（標題は新規入力値・status=draft）/
 *            モジュール構成 / PDCAチェックポイント（日付を期間差分だけシフト・状態リセット）/
 *            KPI定義（baseline ← 前期の最新実績値・target は前期値据え置き＋要見直しフラグ）/
 *            ロジックモデル現行版 → 新計画の第1版（cloned_from_* を記録）/
 *            measure_designs（status→draft・エビデンスC区画は保持）
 *  複製しない: kpi_reports・評価・対話ログ・実験結果・改善アクション（→引き継ぎ経由）・
 *            スケジュール実績・自己評価
 *
 * ── 実装の定石（L5 revise.ts の information_schema 方式を全テーブルに適用）──
 *  列を手で並べない。実スキーマから列を取り、こちらで値を決める列（MANAGED）だけを除外する。
 *  列が増えても複製漏れが起きない（check:clone が実DBで全列運搬を検証する）。
 *  ID対応表（旧→新）を作りながら FK（contributes_to_kpi_id・LM要素のkpi_ids・
 *  measure の kpi_ids_*）を張り替える。
 */

import type { PoolClient } from "pg";

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** テーブルの複製列（MANAGED 以外）を実スキーマから取る */
async function copyColsOf(
  client: PoolClient,
  table: string,
  managed: ReadonlySet<string>,
): Promise<string[]> {
  const res = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = current_schema()
     ORDER BY ordinal_position`,
    [table],
  );
  return res.rows
    .map((r) => r.column_name)
    .filter((c) => !managed.has(c) && SAFE_IDENTIFIER.test(c));
}

const q = (cols: string[]) => cols.map((c) => `"${c}"`).join(", ");

// ── こちらで値を決める列 ─────────────────────────────────

const PROJECT_MANAGED = new Set([
  "id",
  "title",
  "status",
  "plan_start_date",
  "plan_end_date",
  "cloned_from_project_id",
  "created_at",
  "updated_at",
]);

const KPI_MANAGED = new Set([
  "id",
  "project_id",
  "baseline_value",
  "baseline_year",
  "previous_value",
  "previous_target",
  "goal_id",
  "contributes_to_kpi_id",
  "cloned_from_kpi_id",
  "target_needs_review",
  "created_at",
  "updated_at",
]);

const MODULE_CONFIG_MANAGED = new Set(["id", "project_id", "enabled_at"]);

const CHECKPOINT_MANAGED = new Set([
  "id",
  "project_id",
  "scheduled_date",
  "scheduled_date_end",
  "status",
  "started_at",
  "completed_at",
  "completion_notes",
  "linked_evaluation_ids",
]);

const LOGIC_MODEL_MANAGED = new Set([
  "id",
  "project_id",
  "version",
  "is_current",
  "status",
  "issue_hypothesis_id",
  "revised_from_id",
  "revision_reason",
  "source_improvement_action_id",
  "cloned_from_project_id",
  "cloned_from_logic_model_id",
  "generated_at",
  "created_at",
  "updated_at",
]);

const MEASURE_MANAGED = new Set([
  "id",
  "project_id",
  "status",
  "committed_at",
  "issue_hypothesis_id",
  "gap_analysis_ids",
  "measure_dialogue_id",
  "kpi_ids_initial",
  "kpi_ids_intermediate",
  "cloned_from_measure_id",
  "created_at",
  "updated_at",
]);

// ── ロジックモデル要素の kpi_ids 張り替え ──────────────────

/** 要素配列（{id,text,kpi_ids[]} または文字列の後方互換）内の kpi_ids を対応表で張り替える */
export function remapElementKpiIds(section: unknown, kpiMap: Map<string, string>): unknown {
  if (!Array.isArray(section)) return section;
  return section.map((el) => {
    if (!el || typeof el !== "object") return el; // 文字列要素（後方互換）はそのまま
    const o = el as Record<string, unknown>;
    if (!Array.isArray(o["kpi_ids"])) return el;
    const remapped = (o["kpi_ids"] as unknown[])
      .filter((x): x is string => typeof x === "string")
      .map((id) => kpiMap.get(id))
      .filter((x): x is string => typeof x === "string"); // 対応が無いIDは落とす（新計画に無いKPIを指させない）
    return { ...o, kpi_ids: remapped };
  });
}

/** uuid配列を対応表で張り替える（対応が無いIDは落とす） */
export function remapIdArray(ids: unknown, kpiMap: Map<string, string>): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((x): x is string => typeof x === "string")
    .map((id) => kpiMap.get(id))
    .filter((x): x is string => typeof x === "string");
}

/** LM要素のセクション列（この並びで kpi_ids を張り替える） */
export const LM_ELEMENT_SECTIONS = [
  "inputs",
  "activities",
  "outputs",
  "outcomes",
  "initial_outcomes",
  "intermediate_outcomes",
  "long_outcomes",
] as const;

// ── 本体 ─────────────────────────────────────────────────

export interface CloneInput {
  sourceProjectId: string;
  title: string;
  planStartDate: string | null; // YYYY-MM-DD
  planEndDate: string | null;
}

export interface CloneResult {
  newProjectId: string;
  dayShift: number;
  counts: {
    kpis: number;
    moduleConfigs: number;
    checkpoints: number;
    measures: number;
    logicModel: boolean;
  };
  handoverLinked: boolean;
}

/**
 * 前期計画を複製して次期のたたき台を作る。呼び出し側でトランザクションを張ること。
 * 冪等性はトランザクション（失敗時は全ロールバック）で担保する。
 */
export async function cloneNextPeriod(
  client: PoolClient,
  input: CloneInput,
): Promise<CloneResult | null> {
  const src = await client.query<{
    id: string;
    plan_start_date: string | null;
    plan_end_date: string | null;
  }>(
    `SELECT id, to_char(plan_start_date, 'YYYY-MM-DD') AS plan_start_date,
            to_char(plan_end_date, 'YYYY-MM-DD') AS plan_end_date
     FROM projects WHERE id = $1`,
    [input.sourceProjectId],
  );
  const source = src.rows[0];
  if (!source) return null;

  // 期間差分（日）: チェックポイントのシフト量
  let dayShift = 0;
  if (input.planStartDate && source.plan_start_date) {
    const ms = new Date(input.planStartDate).getTime() - new Date(source.plan_start_date).getTime();
    if (Number.isFinite(ms)) dayShift = Math.round(ms / 86_400_000);
  }
  const baselineYear = source.plan_end_date
    ? new Date(source.plan_end_date).getFullYear()
    : null;

  // ── 1. projects ─────────────────────────────────
  const pCols = await copyColsOf(client, "projects", PROJECT_MANAGED);
  const newProj = await client.query<{ id: string }>(
    `INSERT INTO projects (${q(pCols)}, title, status, plan_start_date, plan_end_date, cloned_from_project_id)
     SELECT ${q(pCols)}, $2, 'draft', $3::date, $4::date, id
     FROM projects WHERE id = $1
     RETURNING id`,
    [input.sourceProjectId, input.title, input.planStartDate, input.planEndDate],
  );
  const newProjectId = newProj.rows[0]?.id;
  if (!newProjectId) return null;

  // ── 2. KPI定義（実績は持ち込まず、前期実績を新しい基準値に）──
  const kCols = await copyColsOf(client, "kpis", KPI_MANAGED);
  const oldKpis = await client.query<{
    id: string;
    contributes_to_kpi_id: string | null;
  }>(`SELECT id, contributes_to_kpi_id FROM kpis WHERE project_id = $1 ORDER BY created_at`, [
    input.sourceProjectId,
  ]);
  const kpiMap = new Map<string, string>();
  for (const old of oldKpis.rows) {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO kpis (${q(kCols)}, project_id, baseline_value, baseline_year,
                         previous_value, previous_target, goal_id, contributes_to_kpi_id,
                         cloned_from_kpi_id, target_needs_review)
       SELECT ${q(kCols)}, $1,
              COALESCE(current, baseline_value),  -- baseline ← 前期の最新実績値
              $2,
              current,                             -- previous_value ← 前期実績
              target,                              -- previous_target ← 前期目標
              NULL, NULL, id, true                 -- target は据え置き＋要見直しフラグ
       FROM kpis WHERE id = $3
       RETURNING id`,
      [newProjectId, baselineYear, old.id],
    );
    const newId = ins.rows[0]?.id;
    if (newId) kpiMap.set(old.id, newId);
  }
  // KPI階層（contributes_to_kpi_id）を対応表で張り替える
  for (const old of oldKpis.rows) {
    if (!old.contributes_to_kpi_id) continue;
    const from = kpiMap.get(old.id);
    const to = kpiMap.get(old.contributes_to_kpi_id);
    if (from && to) {
      await client.query(`UPDATE kpis SET contributes_to_kpi_id = $1 WHERE id = $2`, [to, from]);
    }
  }

  // ── 3. モジュール構成 ────────────────────────────
  const mcCols = await copyColsOf(client, "project_module_configs", MODULE_CONFIG_MANAGED);
  const mc = await client.query(
    `INSERT INTO project_module_configs (${q(mcCols)}, project_id)
     SELECT ${q(mcCols)}, $2 FROM project_module_configs WHERE project_id = $1`,
    [input.sourceProjectId, newProjectId],
  );

  // ── 4. PDCAチェックポイント（日付シフト・状態リセット）──
  const cpCols = await copyColsOf(client, "project_pdca_checkpoints", CHECKPOINT_MANAGED);
  const cp = await client.query(
    `INSERT INTO project_pdca_checkpoints
       (${q(cpCols)}, project_id, scheduled_date, scheduled_date_end,
        status, started_at, completed_at, completion_notes, linked_evaluation_ids)
     SELECT ${q(cpCols)}, $2,
            (scheduled_date + $3 * INTERVAL '1 day')::date,
            (scheduled_date_end + $3 * INTERVAL '1 day')::date,
            'upcoming', NULL, NULL, NULL, ARRAY[]::uuid[]
     FROM project_pdca_checkpoints WHERE project_id = $1`,
    [input.sourceProjectId, newProjectId, dayShift],
  );

  // ── 5. ロジックモデル現行版 → 新計画の第1版 ───────
  const lmBase = await client.query<{ id: string }>(
    `SELECT id FROM logic_models WHERE project_id = $1
     ORDER BY is_current DESC, version DESC, created_at DESC LIMIT 1`,
    [input.sourceProjectId],
  );
  let logicModelCloned = false;
  const lmSourceId = lmBase.rows[0]?.id ?? null;
  if (lmSourceId) {
    const lmCols = await copyColsOf(client, "logic_models", LOGIC_MODEL_MANAGED);
    const lmIns = await client.query<{ id: string }>(
      `INSERT INTO logic_models
         (${q(lmCols)}, project_id, version, is_current, status, issue_hypothesis_id,
          cloned_from_project_id, cloned_from_logic_model_id)
       SELECT ${q(lmCols)}, $1, 1, true, 'draft', NULL, $2, id
       FROM logic_models WHERE id = $3
       RETURNING id`,
      [newProjectId, input.sourceProjectId, lmSourceId],
    );
    const newLmId = lmIns.rows[0]?.id;
    if (newLmId) {
      logicModelCloned = true;
      // 要素のkpi_idsを対応表で張り替える（JSONB内のFK）
      const secList = LM_ELEMENT_SECTIONS.map((s) => `"${s}"`).join(", ");
      const lmRow = await client.query(
        `SELECT ${secList} FROM logic_models WHERE id = $1`,
        [newLmId],
      );
      const row = lmRow.rows[0] as Record<string, unknown> | undefined;
      if (row) {
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const sec of LM_ELEMENT_SECTIONS) {
          const remapped = remapElementKpiIds(row[sec], kpiMap);
          vals.push(JSON.stringify(remapped ?? []));
          sets.push(`"${sec}" = $${vals.length}::jsonb`);
        }
        vals.push(newLmId);
        await client.query(
          `UPDATE logic_models SET ${sets.join(", ")} WHERE id = $${vals.length}`,
          vals,
        );
      }
    }
  }

  // ── 6. 施策データセット（draftに落とす・C区画は保持）──
  const mdCols = await copyColsOf(client, "measure_designs", MEASURE_MANAGED);
  const oldMeasures = await client.query<{
    id: string;
    kpi_ids_initial: string[] | null;
    kpi_ids_intermediate: string[] | null;
  }>(
    `SELECT id, kpi_ids_initial, kpi_ids_intermediate
     FROM measure_designs WHERE project_id = $1 ORDER BY sort_order, created_at`,
    [input.sourceProjectId],
  );
  let measureCount = 0;
  for (const old of oldMeasures.rows) {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO measure_designs
         (${q(mdCols)}, project_id, status, committed_at, issue_hypothesis_id,
          gap_analysis_ids, measure_dialogue_id, kpi_ids_initial, kpi_ids_intermediate,
          cloned_from_measure_id)
       SELECT ${q(mdCols)}, $1, 'draft', NULL, NULL,
              ARRAY[]::uuid[], NULL, $2::uuid[], $3::uuid[], id
       FROM measure_designs WHERE id = $4
       RETURNING id`,
      [
        newProjectId,
        remapIdArray(old.kpi_ids_initial, kpiMap),
        remapIdArray(old.kpi_ids_intermediate, kpiMap),
        old.id,
      ],
    );
    if (ins.rows[0]?.id) measureCount++;
  }

  // ── 7. 引き継ぎパッケージの結線（P②の入口）────────
  const linked = await client.query(
    `UPDATE plan_handovers SET target_project_id = $1, updated_at = now()
     WHERE source_project_id = $2 AND status = 'finalized' AND target_project_id IS NULL`,
    [newProjectId, input.sourceProjectId],
  );

  return {
    newProjectId,
    dayShift,
    counts: {
      kpis: kpiMap.size,
      moduleConfigs: mc.rowCount ?? 0,
      checkpoints: cp.rowCount ?? 0,
      measures: measureCount,
      logicModel: logicModelCloned,
    },
    handoverLinked: (linked.rowCount ?? 0) > 0,
  };
}
