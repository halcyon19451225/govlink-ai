import "server-only";
import { type PoolClient } from "pg";
import { query } from "@/lib/db";
import type { ArtifactType } from "./artifact-types";

export interface RecordArtifactInput {
  projectId: string;
  checkpointId?: string | null | undefined;
  moduleId: string;
  artifactType: ArtifactType | string;
  artifactRecordId: string;
  sourceArtifactIds?: string[] | undefined;
  sourceDatasetsSnapshot?: Record<string, string> | undefined; // { dataset_def_id: uploaded_at_iso }
  derivationNote?: string | null | undefined;
  evidenceId?: string | null | undefined;
}

/**
 * module_artifacts にレコードを登録（upsert）する。
 * 各モジュールの WRITE 成功直後にトランザクション内または単独で呼ぶ。
 *
 * client を渡した場合はそのトランザクション内で実行（BEGIN/COMMIT しない）。
 * 渡さない場合はプール接続を使って単独で実行する。
 */
export async function recordArtifact(
  input: RecordArtifactInput,
  client?: PoolClient,
): Promise<string> {
  const {
    projectId,
    checkpointId = null,
    moduleId,
    artifactType,
    artifactRecordId,
    sourceArtifactIds = [],
    sourceDatasetsSnapshot = {},
    derivationNote = null,
    evidenceId = null,
  } = input;

  const sql = `
    INSERT INTO module_artifacts
      (project_id, checkpoint_id, module_id, artifact_type, artifact_record_id,
       source_artifact_ids, source_datasets_snapshot, derivation_note, evidence_id,
       updated_at)
    VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::jsonb, $8, $9, NOW())
    ON CONFLICT (project_id, module_id, artifact_record_id)
    DO UPDATE SET
      checkpoint_id            = EXCLUDED.checkpoint_id,
      artifact_type            = EXCLUDED.artifact_type,
      source_artifact_ids      = EXCLUDED.source_artifact_ids,
      source_datasets_snapshot = EXCLUDED.source_datasets_snapshot,
      derivation_note          = EXCLUDED.derivation_note,
      evidence_id              = EXCLUDED.evidence_id,
      updated_at               = NOW()
    RETURNING id`;

  const params = [
    projectId,
    checkpointId,
    moduleId,
    artifactType,
    artifactRecordId,
    sourceArtifactIds,
    JSON.stringify(sourceDatasetsSnapshot),
    derivationNote,
    evidenceId,
  ];

  let row: { id: string } | null;
  if (client) {
    const result = await client.query<{ id: string }>(sql, params);
    row = result.rows[0] ?? null;
  } else {
    const rows = await query<{ id: string }>(sql, params);
    row = rows[0] ?? null;
  }

  if (!row) throw new Error("module_artifacts の登録に失敗しました");
  return row.id;
}

/**
 * 上流モジュールのレコード ID から module_artifacts.id を解決する。
 * 見つからなければ空配列を返す（上流がまだ未登録でも下流の登録を妨げない）。
 */
export async function resolveArtifactIds(
  projectId: string,
  moduleId: string,
  recordIds: (string | null | undefined)[],
): Promise<string[]> {
  const valid = recordIds.filter((id): id is string => !!id);
  if (valid.length === 0) return [];

  const rows = await query<{ id: string }>(
    `SELECT id FROM module_artifacts
     WHERE project_id = $1 AND module_id = $2 AND artifact_record_id = ANY($3::uuid[])`,
    [projectId, moduleId, valid],
  );
  return rows.map((r) => r.id);
}

/**
 * project_datasets から source_datasets_snapshot 用の辞書を作る。
 * gap_analysis などが「どのデータセットを使ったか」を記録するために呼ぶ。
 */
export async function buildDatasetsSnapshot(
  projectId: string,
): Promise<Record<string, string>> {
  const rows = await query<{ dataset_def_id: string; uploaded_at: string }>(
    `SELECT dataset_def_id, uploaded_at::text FROM project_datasets WHERE project_id = $1`,
    [projectId],
  );
  const snapshot: Record<string, string> = {};
  for (const r of rows) {
    snapshot[r.dataset_def_id] = r.uploaded_at;
  }
  return snapshot;
}
