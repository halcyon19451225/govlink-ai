/**
 * ロジックモデルの改訂を起こす（L5）
 *
 * ── PDCA が一周する最後の一手 ─────────────────────────────
 * A工程（改善）は改善アクションを生む。その反映先の一つが
 * 「ロジックモデルの改訂」（improvement_actions.reflect_logic_model_id）だが、
 * これまでこの欄は**既存の版を指すだけ**だった。
 * 「因果仮説を書き換える」と決めても、書き換える先が用意されず、
 * 担当者は現行版を直接上書きするしかなかった。
 * その結果、改善の前後で計画がどう変わったのかが残らなかった。
 *
 * ここで、改善を理由とする**新しい版**を起こす。
 *   - 現行版の中身をそのまま複製し、新しい版として積む
 *   - revised_from_id で系譜をつなぐ
 *   - source_improvement_action_id で「どの改善が理由か」を残す
 *   - 改善アクションの反映先を新しい版へ向ける
 *
 * 過去の評価が参照している版（program_evaluations.logic_model_id）は動かない。
 * 「この評価は改訂前の第2版を前提にしていた」と後から説明できる。
 *
 * ── 列の複製について ──────────────────────────────────────
 * 複製する列を手で並べると、列が増えるたびにここを直す必要があり、
 * 直し忘れると「改訂したら一部の内容が消える」という事故になる。
 * information_schema から列を取り、明示的に設定するものだけを除外する。
 */

import type { PoolClient } from "pg";

/** 複製せず、こちらで値を決める列 */
const MANAGED_COLUMNS = new Set([
  "id",
  "version",
  "is_current",
  "revised_from_id",
  "revision_reason",
  "source_improvement_action_id",
  "created_at",
  "updated_at",
  "generated_at",
]);

/** 識別子として安全か（information_schema 由来だが念のため） */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface ReviseInput {
  projectId: string;
  /** 起点となる版。省略時は現行版 */
  fromModelId?: string | null;
  /** なぜ改訂するのか。必須（版だけ増えて理由が分からない状態を作らない） */
  reason: string;
  /** この改訂を生んだ改善アクション */
  improvementActionId?: string | null;
}

export interface ReviseResult {
  id: string;
  version: number;
  revisedFromId: string;
  revisedFromVersion: number;
}

/**
 * 現行版（または指定版）を複製して新しい版を起こす。
 * 呼び出し側でトランザクションを張ること。
 */
export async function reviseLogicModel(
  client: PoolClient,
  input: ReviseInput,
): Promise<ReviseResult | null> {
  const { projectId, fromModelId, reason, improvementActionId } = input;

  // ── 起点の版を決める ──────────────────────────────
  const base = await client.query<{ id: string; version: number }>(
    fromModelId
      ? `SELECT id, version FROM logic_models WHERE id = $2 AND project_id = $1`
      : `SELECT id, version FROM logic_models
         WHERE project_id = $1
         ORDER BY is_current DESC, version DESC, created_at DESC
         LIMIT 1`,
    fromModelId ? [projectId, fromModelId] : [projectId],
  );
  const source = base.rows[0];
  if (!source) return null;

  // ── 複製する列を実スキーマから取る ─────────────────
  const colRows = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'logic_models'
       AND table_schema = current_schema()
     ORDER BY ordinal_position`,
  );
  const copyCols = colRows.rows
    .map((r) => r.column_name)
    .filter((c) => !MANAGED_COLUMNS.has(c) && SAFE_IDENTIFIER.test(c));

  if (copyCols.length === 0) return null;

  const quoted = copyCols.map((c) => `"${c}"`).join(", ");

  // ── 現行版を降ろし、新しい版を積む ─────────────────
  await client.query(
    "UPDATE logic_models SET is_current = false WHERE project_id = $1 AND is_current",
    [projectId],
  );

  const inserted = await client.query<{ id: string; version: number }>(
    `INSERT INTO logic_models (
       ${quoted},
       version, is_current, revised_from_id, revision_reason, source_improvement_action_id
     )
     SELECT ${quoted},
            (SELECT COALESCE(MAX(version), 0) + 1 FROM logic_models WHERE project_id = $1),
            true,
            id,
            $2,
            $3
     FROM logic_models
     WHERE id = $4
     RETURNING id, version`,
    [projectId, reason, improvementActionId ?? null, source.id],
  );

  const row = inserted.rows[0];
  if (!row) return null;

  // ── 改善アクションの反映先を新しい版へ向ける ────────
  // 「改訂する」と決めた改善が、実際にどの版になったのかを残す。
  if (improvementActionId) {
    await client.query(
      `UPDATE improvement_actions
       SET reflect_logic_model_id = $1,
           reflected_at = COALESCE(reflected_at, now()),
           reflection_note = COALESCE(
             NULLIF(reflection_note, ''),
             'ロジックモデル第' || $2 || '版として改訂'
           )
       WHERE id = $3 AND project_id = $4`,
      [row.id, row.version, improvementActionId, projectId],
    );
  }

  return {
    id: row.id,
    version: row.version,
    revisedFromId: source.id,
    revisedFromVersion: source.version,
  };
}
