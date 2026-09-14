/**
 * 指標エンジン — 設計: claude/coe-dataset-model.md §9-4・§9-5・§9-7（D4）
 *
 * やることは3つだけ。
 *   ① 版を選ぶ（`resolveInputs`）— 指定した基準日**以前で最も新しい validated 版**。
 *      無ければ「何をいつ時点で上げてほしいか」を構造で返す（不足エラー）。
 *   ② 計算する（`computeIndicator`）— タイプごとに SQL 1本。
 *   ③ 使った版を残す（戻り値の `inputs`）— あとから「この実績はどの版から出たか」を辿れるように。
 *
 * **値を履歴に積むのはここではない。** 積むのはサービス層（`service.ts` の `recordValue`）で、
 * 画面も AI も同じ経路を通る（設計 §10-5）。エンジンは計算して返すだけ。
 *
 * ★ この層は分野に依存しない。特定の行政分野の語彙を書かないこと（check:generic）。
 */
import { query } from "@/lib/db";
import {
  evalFormula,
  parseFormula,
  type AggregateSpec,
  type CrossSpec,
  type Filter,
  type IndicatorSpec,
  type LongitudinalSpec,
  type Missing,
} from "./spec";

/** 分母がこの人数を下回るときは値を出さない（個票の集計。k-匿名性と同じ考え方） */
export const MIN_DENOMINATOR = 5;

export interface UsedVersion {
  datasetId: string;
  datasetName: string;
  datasetVersionId: string;
  asOf: string;
}

export interface ComputeOk {
  ok: true;
  value: number;
  numerator: number | null;
  denominator: number | null;
  n: number | null;
  inputs: { versions: UsedVersion[]; indicators?: { indicatorId: string; valueId: string; value: number }[] };
}
export interface ComputeNg {
  ok: false;
  missing: Missing[];
}
export type ComputeResult = ComputeOk | ComputeNg;

interface DatasetRow {
  id: string;
  name: string;
  kind: "aggregate" | "individual";
  schema: unknown;
}

// ── ① 版の選択 ──────────────────────────────────────────

async function loadDataset(projectId: string, datasetId: string): Promise<DatasetRow | null> {
  const rows = await query<DatasetRow>(
    `SELECT id, name, kind, schema FROM datasets WHERE id = $1 AND project_id = $2`,
    [datasetId, projectId],
  );
  return rows[0] ?? null;
}

/**
 * 基準日以前で最も新しい validated 版を選ぶ。
 * 無ければ「登録済みで最も新しいのはいつか」も一緒に返す（画面の案内文に使う）。
 */
export async function resolveVersion(
  datasetId: string,
  asOf: string,
): Promise<{ versionId: string; asOf: string } | { latestAvailableAsOf: string | null }> {
  const rows = await query<{ id: string; as_of: string }>(
    `SELECT id, as_of::text AS as_of FROM dataset_versions
      WHERE dataset_id = $1 AND status = 'validated' AND as_of <= $2::date
      ORDER BY as_of DESC, uploaded_at DESC LIMIT 1`,
    [datasetId, asOf],
  );
  if (rows[0]) return { versionId: rows[0].id, asOf: rows[0].as_of };
  const any = await query<{ as_of: string }>(
    `SELECT as_of::text AS as_of FROM dataset_versions
      WHERE dataset_id = $1 AND status = 'validated' ORDER BY as_of DESC LIMIT 1`,
    [datasetId],
  );
  return { latestAvailableAsOf: any[0]?.as_of ?? null };
}

/**
 * 設定が必要とする版を全部そろえる。1つでも欠ければ不足を返す。
 * 計算式型の依存（他の指標）はここでは見ない（`computeIndicator` が見る）。
 */
export async function resolveInputs(
  projectId: string,
  spec: IndicatorSpec,
  asOf: string,
): Promise<{ ok: true; versions: UsedVersion[]; datasets: DatasetRow[] } | ComputeNg> {
  if (spec.type === "formula") return { ok: true, versions: [], datasets: [] };

  const ds = await loadDataset(projectId, spec.datasetId);
  if (!ds) {
    return { ok: false, missing: [{ reason: "no_version_before_as_of", datasetId: spec.datasetId, neededAsOf: asOf, latestAvailableAsOf: null }] };
  }
  const v = await resolveVersion(ds.id, asOf);
  if (!("versionId" in v)) {
    return {
      ok: false,
      missing: [{
        reason: "no_version_before_as_of",
        datasetId: ds.id, datasetName: ds.name, kind: ds.kind,
        neededAsOf: asOf, latestAvailableAsOf: v.latestAvailableAsOf,
      }],
    };
  }
  return {
    ok: true,
    versions: [{ datasetId: ds.id, datasetName: ds.name, datasetVersionId: v.versionId, asOf: v.asOf }],
    datasets: [ds],
  };
}

// ── 絞り込みを SQL にする ────────────────────────────────
//
// 値は**必ずパラメータで渡す**（列名だけは識別子として扱い、形を検査してから使う）。

const SAFE_COLUMN = /^[^"'\\;()]{1,120}$/;

function dimsFilterSql(filters: Filter[] | undefined, params: unknown[]): string {
  if (!filters || filters.length === 0) return "";
  const parts: string[] = [];
  for (const f of filters) {
    if (!SAFE_COLUMN.test(f.key)) continue;
    params.push(f.key);
    const keyIdx = params.length;
    params.push(f.in);
    parts.push(`(r.dims ->> $${keyIdx}) = ANY($${params.length}::text[])`);
  }
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
}

// ── ② 計算 ──────────────────────────────────────────────

/** 集計型（集計データの箱）。measures の JSONB から数値を取り出して集める */
async function computeAggregateOnRows(
  spec: AggregateSpec,
  ds: DatasetRow,
  versionId: string,
): Promise<ComputeResult> {
  const cols = Array.isArray(ds.schema) ? (ds.schema as { name: string; role: string }[]) : [];
  const has = (name: string) => cols.some((c) => c.name === name);
  const missing: Missing[] = [];
  if (cols.length > 0 && !has(spec.measure)) {
    missing.push({ reason: "column_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, column: spec.measure });
  }
  if (spec.method === "rate" && spec.denominator && cols.length > 0 && !has(spec.denominator)) {
    missing.push({ reason: "column_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, column: spec.denominator });
  }
  if (missing.length) return { ok: false, missing };

  const params: unknown[] = [versionId, spec.measure];
  const where = dimsFilterSql(spec.filters, params);
  const denomIdx = spec.method === "rate" && spec.denominator ? (params.push(spec.denominator), params.length) : null;

  const rows = await query<{ s: string | null; a: string | null; c: number; d: string | null }>(
    `SELECT SUM((r.measures ->> $2)::numeric) AS s,
            AVG((r.measures ->> $2)::numeric) AS a,
            COUNT(*)::int AS c
            ${denomIdx ? `, SUM((r.measures ->> $${denomIdx})::numeric) AS d` : ", NULL::numeric AS d"}
       FROM dataset_rows r
      WHERE r.dataset_version_id = $1${where}`,
    params,
  );
  const r = rows[0];
  if (!r || r.c === 0) {
    return { ok: false, missing: [{ reason: "too_few_rows", datasetId: ds.id, datasetName: ds.name, kind: ds.kind }] };
  }

  const sum = r.s === null ? null : Number(r.s);
  const avg = r.a === null ? null : Number(r.a);
  const den = r.d === null ? null : Number(r.d);

  switch (spec.method) {
    case "sum":
      if (sum === null) return { ok: false, missing: [{ reason: "column_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, column: spec.measure }] };
      return { ok: true, value: sum, numerator: null, denominator: null, n: r.c, inputs: { versions: [] } };
    case "mean":
    case "value":
      if (avg === null) return { ok: false, missing: [{ reason: "column_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, column: spec.measure }] };
      // 'value' は絞り込みで1行に絞った想定。複数行なら平均になる（画面で注意を出す）
      return { ok: true, value: avg, numerator: null, denominator: null, n: r.c, inputs: { versions: [] } };
    case "count":
      return { ok: true, value: r.c, numerator: null, denominator: null, n: r.c, inputs: { versions: [] } };
    case "rate": {
      if (sum === null || den === null || den === 0) {
        return { ok: false, missing: [{ reason: "too_few_rows", datasetId: ds.id, datasetName: ds.name, kind: ds.kind }] };
      }
      return { ok: true, value: sum / den, numerator: sum, denominator: den, n: r.c, inputs: { versions: [] } };
    }
  }
}

/** 個票の観測から、その基準日時点で有効な1人1行を取り出す共通部分 */
const LATEST_OBS = `
  SELECT DISTINCT ON (o.sid) o.sid, o.value_code, o.value_num, o.value_bool
    FROM observations o
   WHERE o.project_id = $PROJ AND o.attr_key = $ATTR
     AND o.dataset_version_id = ANY($VERS::uuid[])
     AND o.observed_at <= $AT::date
   ORDER BY o.sid, o.observed_at DESC`;

function obsCte(alias: string, projIdx: number, attrIdx: number, versIdx: number, atIdx: number): string {
  return `${alias} AS (${LATEST_OBS
    .replace("$PROJ", `$${projIdx}`)
    .replace("$ATTR", `$${attrIdx}`)
    .replace("$VERS", `$${versIdx}`)
    .replace("$AT", `$${atIdx}`)})`;
}

/** 集計型（個票の箱）。属性の観測を人単位で集める */
async function computeAggregateOnObservations(
  projectId: string,
  spec: AggregateSpec,
  ds: DatasetRow,
  versionId: string,
  asOf: string,
): Promise<ComputeResult> {
  const params: unknown[] = [projectId, spec.measure, [versionId], asOf];
  const rows = await query<{ n: number; s: string | null; a: string | null }>(
    `WITH ${obsCte("latest", 1, 2, 3, 4)}
     SELECT COUNT(*)::int AS n, SUM(value_num) AS s, AVG(value_num) AS a FROM latest`,
    params,
  );
  const r = rows[0];
  if (!r || r.n === 0) {
    return { ok: false, missing: [{ reason: "attr_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, attrKey: spec.measure }] };
  }
  if (r.n < MIN_DENOMINATOR) {
    return { ok: false, missing: [{ reason: "too_few_rows", datasetId: ds.id, datasetName: ds.name, kind: ds.kind }] };
  }
  switch (spec.method) {
    case "count":
      return { ok: true, value: r.n, numerator: null, denominator: null, n: r.n, inputs: { versions: [] } };
    case "sum":
      return { ok: true, value: Number(r.s ?? 0), numerator: null, denominator: null, n: r.n, inputs: { versions: [] } };
    case "mean":
    case "value":
      return { ok: true, value: Number(r.a ?? 0), numerator: null, denominator: null, n: r.n, inputs: { versions: [] } };
    case "rate":
      // 個票の割合は「条件に当てはまる人 ÷ 観測がある人」。条件はクロス集計型で書く
      return { ok: false, missing: [{ reason: "column_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, column: spec.denominator ?? "" }] };
  }
}

/**
 * 経年比較型。同じ人の同じ属性を2時点で比べ、「維持・改善」の割合を出す。
 * **両方の時点に観測がある人だけ**が分母（片方しか無い人は数えない）。
 */
async function computeLongitudinal(
  projectId: string,
  spec: LongitudinalSpec,
  ds: DatasetRow,
  asOf: string,
): Promise<ComputeResult> {
  if (ds.kind !== "individual") {
    return { ok: false, missing: [{ reason: "attr_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, attrKey: spec.attrKey }] };
  }
  // 2時点それぞれで版を選ぶ（過去の時点は過去の版から見る）
  const past = new Date(`${asOf}T00:00:00Z`);
  past.setUTCMonth(past.getUTCMonth() - spec.monthsBack);
  const pastAsOf = past.toISOString().slice(0, 10);

  const vNow = await resolveVersion(ds.id, asOf);
  const vPast = await resolveVersion(ds.id, pastAsOf);
  const missing: Missing[] = [];
  if (!("versionId" in vNow)) {
    missing.push({ reason: "no_version_before_as_of", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, neededAsOf: asOf, latestAvailableAsOf: vNow.latestAvailableAsOf });
  }
  if (!("versionId" in vPast)) {
    missing.push({ reason: "no_version_before_as_of", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, neededAsOf: pastAsOf, latestAvailableAsOf: vPast.latestAvailableAsOf });
  }
  if (missing.length) return { ok: false, missing };
  const nowV = vNow as { versionId: string; asOf: string };
  const pastV = vPast as { versionId: string; asOf: string };

  // 値の並びを「位置」に直す。位置が同じか手前なら維持・改善（improvedWhen による）
  const orderRows = spec.order.map((code, i) => ({ code, pos: i }));
  const params: unknown[] = [
    projectId, spec.attrKey, [nowV.versionId], asOf, [pastV.versionId], pastAsOf,
    JSON.stringify(orderRows),
  ];
  const rows = await query<{ denom: number; numer: number }>(
    `WITH ord AS (
        SELECT (e ->> 'code') AS code, (e ->> 'pos')::int AS pos
          FROM jsonb_array_elements($7::jsonb) AS e
     ),
     ${obsCte("now_obs", 1, 2, 3, 4)},
     ${obsCte("past_obs", 1, 2, 5, 6)}
     SELECT COUNT(*)::int AS denom,
            COUNT(*) FILTER (WHERE ${spec.improvedWhen === "same_or_earlier" ? "n_ord.pos <= p_ord.pos" : "n_ord.pos >= p_ord.pos"})::int AS numer
       FROM past_obs p
       JOIN now_obs n ON n.sid = p.sid
       JOIN ord p_ord ON p_ord.code = p.value_code
       JOIN ord n_ord ON n_ord.code = n.value_code`,
    params,
  );
  const r = rows[0];
  if (!r || r.denom === 0) {
    return { ok: false, missing: [{ reason: "attr_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, attrKey: spec.attrKey }] };
  }
  if (r.denom < MIN_DENOMINATOR) {
    return { ok: false, missing: [{ reason: "too_few_rows", datasetId: ds.id, datasetName: ds.name, kind: ds.kind }] };
  }
  return {
    ok: true,
    value: r.numer / r.denom,
    numerator: r.numer,
    denominator: r.denom,
    n: r.denom,
    inputs: {
      versions: [
        { datasetId: ds.id, datasetName: ds.name, datasetVersionId: pastV.versionId, asOf: pastV.asOf },
        { datasetId: ds.id, datasetName: ds.name, datasetVersionId: nowV.versionId, asOf: nowV.asOf },
      ],
    },
  };
}

/** クロス集計型。条件をすべて満たす人を数える（個票を sid で突合） */
async function computeCross(
  projectId: string,
  spec: CrossSpec,
  ds: DatasetRow,
  versionId: string,
  asOf: string,
): Promise<ComputeResult> {
  if (ds.kind !== "individual") {
    return { ok: false, missing: [{ reason: "attr_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, attrKey: spec.conditions[0]?.key ?? "" }] };
  }
  const countMatching = async (conds: Filter[]): Promise<number> => {
    const params: unknown[] = [projectId, [versionId], asOf];
    const ctes: string[] = [];
    const joins: string[] = [];
    conds.forEach((c, i) => {
      params.push(c.key);
      const attrIdx = params.length;
      params.push(c.in);
      const inIdx = params.length;
      ctes.push(`c${i} AS (${LATEST_OBS
        .replace("$PROJ", "$1").replace("$ATTR", `$${attrIdx}`)
        .replace("$VERS", "$2").replace("$AT", "$3")})`);
      joins.push(i === 0
        ? `FROM c0 WHERE c0.value_code = ANY($${inIdx}::text[])`
        : `AND EXISTS (SELECT 1 FROM c${i} WHERE c${i}.sid = c0.sid AND c${i}.value_code = ANY($${inIdx}::text[]))`);
    });
    const rows = await query<{ n: number }>(
      `WITH ${ctes.join(", ")} SELECT COUNT(*)::int AS n ${joins.join(" ")}`,
      params,
    );
    return rows[0]?.n ?? 0;
  };

  const numer = await countMatching(spec.conditions);
  if (spec.method === "count") {
    return { ok: true, value: numer, numerator: null, denominator: null, n: numer, inputs: { versions: [] } };
  }
  const denom = spec.denominatorConditions && spec.denominatorConditions.length > 0
    ? await countMatching(spec.denominatorConditions)
    : (await query<{ n: number }>(
        `SELECT COUNT(DISTINCT sid)::int AS n FROM observations
          WHERE project_id = $1 AND dataset_version_id = $2 AND observed_at <= $3::date`,
        [projectId, versionId, asOf],
      ))[0]?.n ?? 0;
  if (denom === 0) {
    return { ok: false, missing: [{ reason: "attr_missing", datasetId: ds.id, datasetName: ds.name, kind: ds.kind, attrKey: spec.conditions[0]?.key ?? "" }] };
  }
  if (denom < MIN_DENOMINATOR) {
    return { ok: false, missing: [{ reason: "too_few_rows", datasetId: ds.id, datasetName: ds.name, kind: ds.kind }] };
  }
  return { ok: true, value: numer / denom, numerator: numer, denominator: denom, n: denom, inputs: { versions: [] } };
}

/** 計算式型。参照する指標の**同じ基準日の値**から計算する（無ければ不足） */
async function computeFormula(
  projectId: string,
  expression: string,
  asOf: string,
): Promise<ComputeResult> {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return { ok: false, missing: [{ reason: "dependency_missing", neededAsOf: asOf }] };

  const values = new Map<string, number>();
  const used: { indicatorId: string; valueId: string; value: number }[] = [];
  const missing: Missing[] = [];
  for (const id of Array.from(new Set(parsed.refs))) {
    const rows = await query<{ id: string; value: string | null; label: string }>(
      `SELECT v.id, v.value, i.label
         FROM indicator_values v JOIN indicators i ON i.id = v.indicator_id
        WHERE v.indicator_id = $1 AND i.project_id = $2 AND v.scope = 'plan'
          AND v.as_of = $3::date AND v.cohort_id IS NULL AND v.arm IS NULL
        ORDER BY v.computed_at DESC LIMIT 1`,
      [id, projectId, asOf],
    );
    const r = rows[0];
    if (!r || r.value === null) {
      const label = await query<{ label: string }>(`SELECT label FROM indicators WHERE id = $1 AND project_id = $2`, [id, projectId]);
      missing.push({
        reason: "dependency_missing", indicatorId: id, neededAsOf: asOf,
        ...(label[0]?.label ? { indicatorLabel: label[0]!.label } : {}),
      });
      continue;
    }
    values.set(id, Number(r.value));
    used.push({ indicatorId: id, valueId: r.id, value: Number(r.value) });
  }
  if (missing.length) return { ok: false, missing };

  const v = evalFormula(parsed.node, values);
  if (v === null || !Number.isFinite(v)) {
    return { ok: false, missing: [{ reason: "dependency_missing", neededAsOf: asOf }] };
  }
  return { ok: true, value: v, numerator: null, denominator: null, n: null, inputs: { versions: [], indicators: used } };
}

// ── 入口 ────────────────────────────────────────────────

/**
 * 指標を1つ計算する。**値を履歴に積むのはサービス層の仕事**（ここは返すだけ）。
 * 計算できないときは `{ok:false, missing:[…]}`。文章ではなく構造で返す（設計 §9-5）。
 */
export async function computeIndicator(
  projectId: string,
  spec: IndicatorSpec,
  asOf: string,
): Promise<ComputeResult> {
  if (spec.type === "formula") return computeFormula(projectId, spec.expression, asOf);
  if (spec.type === "longitudinal") {
    const ds = await loadDataset(projectId, spec.datasetId);
    if (!ds) return { ok: false, missing: [{ reason: "no_version_before_as_of", datasetId: spec.datasetId, neededAsOf: asOf, latestAvailableAsOf: null }] };
    return computeLongitudinal(projectId, spec, ds, asOf);
  }

  const resolved = await resolveInputs(projectId, spec, asOf);
  if (!resolved.ok) return resolved;
  const ds = resolved.datasets[0]!;
  const version = resolved.versions[0]!;

  const result = spec.type === "cross"
    ? await computeCross(projectId, spec, ds, version.datasetVersionId, asOf)
    : ds.kind === "individual"
      ? await computeAggregateOnObservations(projectId, spec, ds, version.datasetVersionId, asOf)
      : await computeAggregateOnRows(spec, ds, version.datasetVersionId);

  // 使った版は、どのタイプでも同じ形で残す
  if (result.ok && result.inputs.versions.length === 0) result.inputs.versions = resolved.versions;
  return result;
}
