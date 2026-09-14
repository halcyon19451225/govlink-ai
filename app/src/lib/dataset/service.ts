/**
 * データセット（箱・版）のサービス層 — 設計: claude/coe-dataset-model.md §4・§10-5
 *
 * **画面（API ルート）も AI（対話の確定処理）も、必ずここを通る。** 「AI 専用の近道」は作らない。
 * すべての作成・変更・取込・ダウンロードは `activity_log` に同じ形で残り、
 * AI の操作でも actor はその対話の担当者（承認した人）になる。
 *
 * D2 の範囲: 集計データ（aggregate）の箱・版・行。個票（individual）の版の取込は D5
 * （庁内の変換ツールの出力 zip を非同期で取り込む）。ここでは箱の作成までを受け付ける。
 */
import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "@/lib/db";
import { uploadToStorage, downloadFromStorage } from "@/lib/storage";
import type { ColumnSpec, DatasetKind } from "./types";
import { validateColumnSchema, validateAggregateRows, type RowError } from "./aggregateSchema";
import { parseCsv } from "./csv";
import { scanForMyNumber } from "./guard";
import { CARE_INSURANCE_DICTIONARY } from "./dictionary";

// ── 操作主体 ────────────────────────────────────────────────

export type ActivityVia =
  | "ui"
  | "bulk"
  | "gap_analysis"
  | "dialogue"
  | "evaluation"
  | "auto_tasks"
  | "migration";

export interface Actor {
  /** user_roles.id。AI の操作でも、その対話の担当者 */
  userRoleId: string | null;
  municipalityId: string;
  via: ActivityVia;
  /** via='dialogue' のとき {dialogue_kind, dialogue_id, turn_no} */
  dialogueRef?: Record<string, unknown>;
}

export class DatasetError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 413 | 501 = 400,
  ) {
    super(message);
  }
}

// ── 型 ──────────────────────────────────────────────────────

export interface DatasetRow {
  id: string;
  project_id: string;
  kind: DatasetKind;
  name: string;
  description: string | null;
  template_id: string | null;
  schema: ColumnSpec[] | { attr_keys: string[] };
  acquisition: Record<string, unknown> | null;
  time_granularity: "day" | "month" | "fiscal_year";
  created_by: string | null;
  created_via: string;
  created_at: string;
  updated_at: string;
}

export interface DatasetVersionRow {
  id: string;
  dataset_id: string;
  as_of: string;
  file_name: string | null;
  storage_path: string | null;
  file_digest: string | null;
  file_size_bytes: number | null;
  status: "pending" | "validated" | "rejected";
  accepted: number | null;
  rejected: number | null;
  suppressed: number | null;
  replaced: number | null;
  reject_reasons: unknown;
  key_id: string | null;
  dictionary_version: number | null;
  k_observed: number | null;
  row_count: number | null;
  note: string | null;
  uploaded_by: string | null;
  uploaded_via: string;
  uploaded_at: string;
  validated_at: string | null;
}

export interface DatasetListItem extends DatasetRow {
  version_count: number;
  latest_as_of: string | null;
  latest_status: DatasetVersionRow["status"] | null;
  latest_uploaded_at: string | null;
}

export interface TemplateRow {
  id: string;
  display_name: string;
  description: string;
  kind: DatasetKind;
  column_schema: ColumnSpec[] | null;
  attr_keys: string[] | null;
  time_granularity: string;
  update_frequency: string | null;
  source_description: string | null;
  plan_types: string[];
}

// ── 上限（30 秒制限の内側で同期処理できる範囲） ───────────────
export const AGGREGATE_MAX_BYTES = 5 * 1024 * 1024;
export const AGGREGATE_MAX_ROWS = 50_000;

// ── 操作履歴 ─────────────────────────────────────────────────

export async function logActivity(
  client: PoolClient | null,
  entry: {
    projectId: string | null;
    actor: Actor;
    entity: "dataset" | "dataset_version";
    entityId: string;
    action: "create" | "update" | "ingest" | "reject" | "download";
    summary?: Record<string, unknown>;
  },
): Promise<void> {
  const sql = `INSERT INTO activity_log
      (project_id, municipality_id, actor, via, dialogue_ref, entity, entity_id, action, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  const params = [
    entry.projectId,
    entry.actor.municipalityId,
    entry.actor.userRoleId,
    entry.actor.via,
    entry.actor.dialogueRef ? JSON.stringify(entry.actor.dialogueRef) : null,
    entry.entity,
    entry.entityId,
    entry.action,
    JSON.stringify(entry.summary ?? {}),
  ];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}

// ── 参照 ─────────────────────────────────────────────────────

export async function listTemplates(planType: string | null): Promise<TemplateRow[]> {
  return query<TemplateRow>(
    `SELECT id, display_name, description, kind, column_schema, attr_keys, time_granularity,
            update_frequency, source_description, plan_types
       FROM dataset_definitions
      WHERE $1 = ANY(plan_types) OR 'custom' = ANY(plan_types)
      ORDER BY kind, id`,
    [planType ?? "custom"],
  );
}

export async function listDatasets(projectId: string): Promise<DatasetListItem[]> {
  return query<DatasetListItem>(
    `SELECT d.*,
            (SELECT COUNT(*)::int FROM dataset_versions v WHERE v.dataset_id = d.id) AS version_count,
            lv.as_of::text AS latest_as_of, lv.status AS latest_status, lv.uploaded_at::text AS latest_uploaded_at
       FROM datasets d
       LEFT JOIN LATERAL (
         SELECT as_of, status, uploaded_at FROM dataset_versions v
          WHERE v.dataset_id = d.id AND v.status <> 'rejected'
          ORDER BY as_of DESC, uploaded_at DESC LIMIT 1
       ) lv ON true
      WHERE d.project_id = $1
      ORDER BY d.kind, d.name`,
    [projectId],
  );
}

export async function getDataset(projectId: string, datasetId: string): Promise<DatasetRow | null> {
  return queryOne<DatasetRow>(`SELECT * FROM datasets WHERE id = $1 AND project_id = $2`, [datasetId, projectId]);
}

export async function listVersions(datasetId: string): Promise<DatasetVersionRow[]> {
  return query<DatasetVersionRow>(
    `SELECT id, dataset_id, as_of::text AS as_of, file_name, storage_path, file_digest, file_size_bytes, status,
            accepted, rejected, suppressed, replaced, reject_reasons, key_id, dictionary_version, k_observed,
            row_count, note, uploaded_by, uploaded_via, uploaded_at::text AS uploaded_at, validated_at::text AS validated_at
       FROM dataset_versions WHERE dataset_id = $1
      ORDER BY as_of DESC, uploaded_at DESC`,
    [datasetId],
  );
}

export async function getVersion(
  projectId: string,
  datasetId: string,
  versionId: string,
): Promise<DatasetVersionRow | null> {
  return queryOne<DatasetVersionRow>(
    `SELECT v.id, v.dataset_id, v.as_of::text AS as_of, v.file_name, v.storage_path, v.file_digest, v.file_size_bytes,
            v.status, v.accepted, v.rejected, v.suppressed, v.replaced, v.reject_reasons, v.key_id,
            v.dictionary_version, v.k_observed, v.row_count, v.note, v.uploaded_by, v.uploaded_via,
            v.uploaded_at::text AS uploaded_at, v.validated_at::text AS validated_at
       FROM dataset_versions v JOIN datasets d ON d.id = v.dataset_id
      WHERE v.id = $1 AND v.dataset_id = $2 AND d.project_id = $3`,
    [versionId, datasetId, projectId],
  );
}

export async function sampleRows(versionId: string, limit = 50) {
  return query<{ row_no: number; dims: Record<string, string>; period: string; measures: Record<string, number> }>(
    `SELECT row_no, dims, period::text AS period, measures FROM dataset_rows
      WHERE dataset_version_id = $1 ORDER BY row_no LIMIT $2`,
    [versionId, limit],
  );
}

/** 版の操作履歴（誰が・どの経路で） */
export async function versionActivity(versionId: string) {
  return query<{ actor: string | null; via: string; action: string; summary: unknown; at: string }>(
    `SELECT actor, via, action, summary, at::text AS at FROM activity_log
      WHERE entity = 'dataset_version' AND entity_id = $1 ORDER BY at DESC LIMIT 50`,
    [versionId],
  );
}

// ── 箱 ───────────────────────────────────────────────────────

export interface CreateDatasetInput {
  kind: DatasetKind;
  name: string;
  description?: string | null;
  templateId?: string | null;
  /** aggregate: 列定義 / individual: 属性キー */
  columnSchema?: ColumnSpec[];
  attrKeys?: string[];
  acquisition?: Record<string, unknown> | null;
  timeGranularity?: "day" | "month" | "fiscal_year";
}

export async function createDataset(actor: Actor, projectId: string, input: CreateDatasetInput): Promise<DatasetRow> {
  const name = (input.name ?? "").trim();
  if (!name) throw new DatasetError("箱の名称が必要です");
  if (name.length > 120) throw new DatasetError("箱の名称は120文字以内にしてください");
  if (input.kind !== "aggregate" && input.kind !== "individual") throw new DatasetError("種別が不正です");

  let schema: ColumnSpec[] | { attr_keys: string[] };
  if (input.kind === "aggregate") {
    const cols = (input.columnSchema ?? []).map((c) => ({
      name: String(c.name ?? "").trim(),
      role: c.role,
      type: c.type,
      ...(c.codes ? { codes: c.codes } : {}),
      ...(c.required === false ? { required: false } : {}),
    }));
    if (cols.length === 0) throw new DatasetError("集計データの箱には列定義が必要です");
    const errors = validateColumnSchema(cols);
    if (errors.length) throw new DatasetError(`列定義に誤りがあります: ${errors.join("・")}`);
    schema = cols;
  } else {
    const keys = Array.from(new Set((input.attrKeys ?? []).map((k) => String(k).trim()).filter(Boolean)));
    if (keys.length === 0) throw new DatasetError("個票データの箱には属性（辞書のキー）が1つ以上必要です");
    const unknown = keys.filter((k) => !CARE_INSURANCE_DICTIONARY.some((d) => d.key === k && d.cloudAllowed));
    if (unknown.length) throw new DatasetError(`辞書に無い、または持ち込めない属性です: ${unknown.join(", ")}`);
    schema = { attr_keys: keys };
  }

  const templateId = input.templateId ?? null;
  if (templateId) {
    const t = await queryOne<{ id: string; kind: string }>(`SELECT id, kind FROM dataset_definitions WHERE id = $1`, [templateId]);
    if (!t) throw new DatasetError("テンプレートが見つかりません", 404);
    if (t.kind !== input.kind) throw new DatasetError("テンプレートの種別と箱の種別が一致しません");
  }

  const row = await transaction(async (client) => {
    const r = await client.query<DatasetRow>(
      `INSERT INTO datasets (project_id, kind, name, description, template_id, schema, acquisition, time_granularity, created_by, created_via)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        projectId,
        input.kind,
        name,
        input.description?.trim() || null,
        templateId,
        JSON.stringify(schema),
        input.acquisition ? JSON.stringify(input.acquisition) : null,
        input.timeGranularity ?? "fiscal_year",
        actor.userRoleId,
        actor.via === "dialogue" ? "dialogue" : "ui",
      ],
    );
    const created = r.rows[0]!;
    await logActivity(client, {
      projectId, actor, entity: "dataset", entityId: created.id, action: "create",
      summary: { kind: input.kind, name, template_id: templateId },
    });
    return created;
  });
  return row;
}

export async function updateDataset(
  actor: Actor,
  projectId: string,
  datasetId: string,
  patch: { name?: string; description?: string | null; acquisition?: Record<string, unknown> | null },
): Promise<DatasetRow> {
  const existing = await getDataset(projectId, datasetId);
  if (!existing) throw new DatasetError("箱が見つかりません", 404);
  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!name) throw new DatasetError("箱の名称が必要です");
  const row = await transaction(async (client) => {
    const r = await client.query<DatasetRow>(
      `UPDATE datasets SET name = $3, description = $4, acquisition = $5, updated_at = now()
        WHERE id = $1 AND project_id = $2 RETURNING *`,
      [
        datasetId, projectId, name,
        patch.description !== undefined ? patch.description?.trim() || null : existing.description,
        patch.acquisition !== undefined ? (patch.acquisition ? JSON.stringify(patch.acquisition) : null) : existing.acquisition ? JSON.stringify(existing.acquisition) : null,
      ],
    );
    await logActivity(client, {
      projectId, actor, entity: "dataset", entityId: datasetId, action: "update",
      summary: { fields: Object.keys(patch) },
    });
    return r.rows[0]!;
  });
  return row;
}

// ── 版（集計データ） ──────────────────────────────────────────

export interface AddVersionInput {
  asOf: string; // YYYY-MM-DD
  fileName: string;
  bytes: Uint8Array;
  contentType?: string;
  note?: string | null;
}

export interface AddVersionResult {
  version: DatasetVersionRow;
  accepted: number;
  errors: RowError[];
  encoding: string;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-぀-ヿ一-龯]/g, "_").slice(0, 120);
}

/**
 * 集計データの版を追加する。
 * 方針: 1行でも検証に失敗したら**版全体を rejected**にし、行は取り込まない（位置と理由を返す）。
 * 集計データは行が欠けると指標の値が黙って狂うため、部分取込はしない。
 */
export async function addAggregateVersion(
  actor: Actor,
  projectId: string,
  datasetId: string,
  input: AddVersionInput,
): Promise<AddVersionResult> {
  const ds = await getDataset(projectId, datasetId);
  if (!ds) throw new DatasetError("箱が見つかりません", 404);
  if (ds.kind !== "aggregate") {
    throw new DatasetError(
      "個票データの版は、庁内の変換ツールの出力（zip）を取り込む機能（D5）で追加します。この画面からは集計データだけを上げられます",
      501,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new DatasetError("基準日は YYYY-MM-DD で指定してください");
  if (input.bytes.length === 0) throw new DatasetError("ファイルが空です");
  if (input.bytes.length > AGGREGATE_MAX_BYTES) {
    throw new DatasetError(`ファイルが大きすぎます（上限 ${AGGREGATE_MAX_BYTES / 1024 / 1024} MB）`, 413);
  }

  const parsed = parseCsv(input.bytes);
  if (parsed.header.length === 0 || parsed.rows.length === 0) throw new DatasetError("CSV に行がありません（ヘッダ行と1行以上のデータが必要です）");
  if (parsed.rows.length > AGGREGATE_MAX_ROWS) throw new DatasetError(`行数が多すぎます（上限 ${AGGREGATE_MAX_ROWS} 行）`, 413);

  const schema = ds.schema as ColumnSpec[];
  const missingCols = schema.filter((c) => c.required !== false && !parsed.header.includes(c.name)).map((c) => c.name);

  // 個人番号ガード（列定義に無い列も含めて全セルを走査する）
  const guardHits = scanForMyNumber(parsed.rows);

  const { rows, errors } = missingCols.length || guardHits.length
    ? { rows: [], errors: [] as RowError[] }
    : validateAggregateRows(schema, parsed.rows, input.asOf);

  const versionId = randomUUID();
  const digest = createHash("sha256").update(input.bytes).digest("hex");
  const storagePath = `${projectId}/${datasetId}/${versionId}_${safeFileName(input.fileName)}`;
  const rejected = missingCols.length > 0 || guardHits.length > 0 || errors.length > 0;

  const rejectReasons = rejected
    ? {
        missing_columns: missingCols,
        my_number_like: guardHits.length,
        my_number_positions: guardHits.slice(0, 20),
        row_errors: errors.length,
        row_error_samples: errors.slice(0, 20),
        malformed_rows: parsed.malformed.length,
      }
    : parsed.malformed.length > 0
      ? { malformed_rows: parsed.malformed.length, malformed_samples: parsed.malformed.slice(0, 20) }
      : null;

  // 元ファイルは検証結果に関わらず保存する（拒否された版も「何を上げたか」は残す）。
  // 個人番号様の値が含まれる場合だけは保存しない（クラウドに置かない）
  let savedPath: string | null = null;
  if (guardHits.length === 0) {
    await uploadToStorage("datasets", storagePath, Buffer.from(input.bytes), input.contentType || "text/csv");
    savedPath = storagePath;
  }

  const version = await transaction(async (client) => {
    const r = await client.query<DatasetVersionRow>(
      `INSERT INTO dataset_versions
         (id, dataset_id, as_of, file_name, storage_path, file_digest, file_size_bytes, ingest_key, status,
          accepted, rejected, reject_reasons, row_count, note, uploaded_by, uploaded_via, uploaded_at, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), CASE WHEN $9 = 'validated' THEN now() END)
       RETURNING id, dataset_id, as_of::text AS as_of, file_name, storage_path, file_digest, file_size_bytes, status,
                 accepted, rejected, suppressed, replaced, reject_reasons, key_id, dictionary_version, k_observed,
                 row_count, note, uploaded_by, uploaded_via, uploaded_at::text AS uploaded_at, validated_at::text AS validated_at`,
      [
        versionId, datasetId, input.asOf, input.fileName, savedPath, digest, input.bytes.length,
        `${datasetId}:${digest}:${input.asOf}:${versionId.slice(0, 8)}`,
        rejected ? "rejected" : "validated",
        rejected ? 0 : rows.length,
        rejected ? parsed.rows.length : parsed.malformed.length,
        rejectReasons ? JSON.stringify(rejectReasons) : null,
        rejected ? 0 : rows.length,
        input.note?.trim() || (guardHits.length ? "個人番号様の値が含まれていたため、ファイルは保存していません" : null),
        actor.userRoleId,
        actor.via,
      ],
    );
    if (!rejected) {
      // 500 行ずつまとめて INSERT
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const values: unknown[] = [];
        const tuples = chunk.map((row, j) => {
          const base = values.length;
          values.push(versionId, i + j + 1, JSON.stringify(row.dims), row.period, JSON.stringify(row.measures));
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        });
        await client.query(
          `INSERT INTO dataset_rows (dataset_version_id, row_no, dims, period, measures) VALUES ${tuples.join(",")}`,
          values,
        );
      }
    }
    await logActivity(client, {
      projectId, actor, entity: "dataset_version", entityId: versionId, action: rejected ? "reject" : "ingest",
      summary: {
        dataset_id: datasetId, as_of: input.asOf, file_name: input.fileName, bytes: input.bytes.length,
        encoding: parsed.encoding, accepted: rejected ? 0 : rows.length,
        missing_columns: missingCols.length, row_errors: errors.length, my_number_like: guardHits.length,
      },
    });
    return r.rows[0]!;
  });

  return { version, accepted: rejected ? 0 : rows.length, errors, encoding: parsed.encoding };
}

export async function rejectVersion(
  actor: Actor,
  projectId: string,
  datasetId: string,
  versionId: string,
  note: string | null,
): Promise<DatasetVersionRow> {
  const v = await getVersion(projectId, datasetId, versionId);
  if (!v) throw new DatasetError("版が見つかりません", 404);
  if (v.status === "rejected") return v;
  return transaction(async (client) => {
    // 行は消さない（指標値が参照しうる）。status だけ落として一覧から隠す
    // ⚠ 同じトランザクション（client）で読み返す。別接続の getVersion() は COMMIT 前の状態を見る
    const r = await client.query<DatasetVersionRow>(
      `UPDATE dataset_versions SET status = 'rejected', note = COALESCE($3, note) WHERE id = $1 AND dataset_id = $2
       RETURNING id, dataset_id, as_of::text AS as_of, file_name, storage_path, file_digest, file_size_bytes, status,
                 accepted, rejected, suppressed, replaced, reject_reasons, key_id, dictionary_version, k_observed,
                 row_count, note, uploaded_by, uploaded_via, uploaded_at::text AS uploaded_at, validated_at::text AS validated_at`,
      [versionId, datasetId, note?.trim() || null],
    );
    await logActivity(client, {
      projectId, actor, entity: "dataset_version", entityId: versionId, action: "reject",
      summary: { dataset_id: datasetId, manual: true, note: note?.trim() || null },
    });
    return r.rows[0]!;
  });
}

export async function downloadVersion(
  actor: Actor,
  projectId: string,
  datasetId: string,
  versionId: string,
): Promise<{ fileName: string; bytes: Buffer }> {
  const v = await getVersion(projectId, datasetId, versionId);
  if (!v) throw new DatasetError("版が見つかりません", 404);
  if (!v.storage_path) throw new DatasetError("この版にはファイルが保存されていません", 404);
  const bytes = await downloadFromStorage("datasets", v.storage_path);
  await logActivity(null, {
    projectId, actor, entity: "dataset_version", entityId: versionId, action: "download",
    summary: { dataset_id: datasetId, file_name: v.file_name, bytes: bytes.length },
  });
  return { fileName: v.file_name ?? `version-${versionId}.csv`, bytes };
}

// ── 他モジュール向けの参照（旧 project_datasets の代替） ─────────

/**
 * 「箱ごとの最新の有効な版」を返す。ギャップ分析・リネージ・成果物記録が使う。
 * 旧 project_datasets の `dataset_def_id` は箱の `template_id` に対応する。
 */
export async function latestVersionsByTemplate(projectId: string): Promise<
  Array<{ dataset_id: string; template_id: string | null; name: string; kind: DatasetKind; version_id: string; as_of: string; file_name: string | null; storage_path: string | null; uploaded_at: string }>
> {
  return query(
    `SELECT d.id AS dataset_id, d.template_id, d.name, d.kind, v.id AS version_id, v.as_of::text AS as_of,
            v.file_name, v.storage_path, v.uploaded_at::text AS uploaded_at
       FROM datasets d
       JOIN LATERAL (
         SELECT * FROM dataset_versions x WHERE x.dataset_id = d.id AND x.status <> 'rejected'
          ORDER BY as_of DESC, uploaded_at DESC LIMIT 1
       ) v ON true
      WHERE d.project_id = $1
      ORDER BY d.name`,
    [projectId],
  );
}

// ── セッション → Actor ────────────────────────────────────────
import type { Session } from "next-auth";

/** API ルート用。画面からの操作は via='ui'。AI の確定処理は via='dialogue' と dialogueRef を渡す */
export function actorFromSession(session: Session, via: ActivityVia = "ui", dialogueRef?: Record<string, unknown>): Actor {
  return {
    userRoleId: session.user?.userRoleId ?? null,
    municipalityId: session.user?.municipalityId ?? "",
    via,
    ...(dialogueRef ? { dialogueRef } : {}),
  };
}
