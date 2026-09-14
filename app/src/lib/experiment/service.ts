/**
 * 実験の割付 — サービス層（設計: claude/coe-dataset-model.md §5-3・§11・§10-5）
 *
 * 規律:
 *   ① **生成は1回だけ。** 既に割付がある対象群には作らない（DB 側も UPDATE/DELETE を断る・072）
 *   ② actor は生成した担当者。AI ではない
 *   ③ 生成も、寄せによる食い違いの検出も、`activity_log` に同じ形で残る
 *
 * ★ この層は分野に依存しない。特定の行政分野の語彙を書かないこと（check:generic）。
 */
import { query, queryOne, transaction } from "@/lib/db";
import { logActivity, type Actor } from "@/lib/activity";
import {
  assign,
  detectMergeConflicts,
  isAssignable,
  type Assignment,
  type MergeConflict,
} from "./assign";

export class ExperimentError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export interface GenerateInput {
  cohortId: string;
  design: string;
  seed: string;
  arms: string[];
  measureDesignId?: string | null;
  /** 層別に使う属性キー（準識別子）。省略すると層別なし */
  stratumAttrKey?: string | null;
  /** クラスターに使う属性キー。クラスター単位の設計では必須 */
  clusterAttrKey?: string | null;
  /** 属性を読む基準日（省略時は対象群の as_of） */
  asOf?: string | null;
}

export interface GenerateResult {
  cohortId: string;
  count: number;
  summary: Record<string, number>;
  seedDigest: string;
}

/**
 * 対象群のメンバーに、層別とクラスターの値を添えて取り出す。
 * 値は個票の観測（observations）から、基準日以前で最も新しいものを採る。
 */
async function loadUnits(
  projectId: string,
  cohortId: string,
  asOf: string,
  stratumAttrKey: string | null,
  clusterAttrKey: string | null,
): Promise<{ sid: string; stratum: string | null; clusterKey: string | null }[]> {
  return query<{ sid: string; stratum: string | null; clusterKey: string | null }>(
    `SELECT m.sid,
            CASE WHEN $4::text IS NULL THEN NULL ELSE (
              SELECT COALESCE(o.value_code, o.value_num::text, o.value_bool::text)
                FROM observations o
               WHERE o.project_id = $1 AND o.sid = m.sid AND o.attr_key = $4::text
                 AND o.observed_at <= $3::date
               ORDER BY o.observed_at DESC LIMIT 1) END AS stratum,
            CASE WHEN $5::text IS NULL THEN NULL ELSE (
              SELECT COALESCE(o.value_code, o.value_num::text, o.value_bool::text)
                FROM observations o
               WHERE o.project_id = $1 AND o.sid = m.sid AND o.attr_key = $5::text
                 AND o.observed_at <= $3::date
               ORDER BY o.observed_at DESC LIMIT 1) END AS "clusterKey"
       FROM cohort_members m
      WHERE m.cohort_id = $2
      ORDER BY m.sid`,
    [projectId, cohortId, asOf, stratumAttrKey, clusterAttrKey],
  );
}

/**
 * 割付を生成して凍結する。
 *
 * **やり直しはできない。** 既に割付がある対象群に対しては断る
 * （やり直したいときは新しい対象群を作る。そうすれば「いつ何を決めたか」が残る）。
 */
export async function generateAssignments(
  actor: Actor,
  projectId: string,
  input: GenerateInput,
): Promise<GenerateResult> {
  if (!isAssignable(input.design)) {
    throw new ExperimentError(
      `この設計（${input.design}）では割付を作りません。比較の作り方はデータ側で決まっています`,
    );
  }
  const cohort = await queryOne<{ id: string; as_of: string; status: string; name: string }>(
    `SELECT id, as_of::text AS as_of, status, name FROM cohorts WHERE id = $1 AND project_id = $2`,
    [input.cohortId, projectId],
  );
  if (!cohort) throw new ExperimentError("対象群が見つかりません", 404);

  const existing = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM experiment_assignments WHERE cohort_id = $1`,
    [input.cohortId],
  );
  if ((existing?.n ?? 0) > 0) {
    throw new ExperimentError(
      `この対象群には既に割付があります（${existing?.n} 人）。` +
        `割付はやり直せません（事前登録のため）。やり直すときは新しい対象群を作ってください`,
      409,
    );
  }

  const asOf = input.asOf ?? cohort.as_of;
  const units = await loadUnits(
    projectId,
    input.cohortId,
    asOf,
    input.stratumAttrKey ?? null,
    input.clusterAttrKey ?? null,
  );
  if (units.length === 0) {
    throw new ExperimentError("この対象群にはまだ人が入っていません（個票の取込が先です）");
  }

  const result = assign({ design: input.design, seed: input.seed, arms: input.arms, units });
  if (!result.ok) throw new ExperimentError(result.reason);

  await transaction(async (client) => {
    // 500 件ずつまとめて INSERT
    const rows = result.assignments;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values: unknown[] = [];
      const tuples = chunk.map((a) => {
        const b = values.length;
        values.push(
          input.cohortId, a.sid, a.arm, a.stratum, a.clusterKey,
          result.seedDigest, input.design, input.measureDesignId ?? null, actor.userRoleId,
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
      });
      await client.query(
        `INSERT INTO experiment_assignments
           (cohort_id, sid, arm, stratum, cluster_key, seed_digest, design, measure_design_id, assigned_by)
         VALUES ${tuples.join(",")}`,
        values,
      );
    }
    await logActivity(client, {
      projectId,
      actor,
      entity: "experiment_assignment",
      entityId: input.cohortId,
      action: "create",
      summary: {
        design: input.design,
        arms: input.arms,
        count: rows.length,
        summary: result.summary,
        seed_digest: result.seedDigest,
        stratum_attr: input.stratumAttrKey ?? null,
        cluster_attr: input.clusterAttrKey ?? null,
        as_of: asOf,
      },
    });
  });

  return {
    cohortId: input.cohortId,
    count: result.assignments.length,
    summary: result.summary,
    seedDigest: result.seedDigest,
  };
}

export async function listAssignments(
  projectId: string,
  cohortId: string,
): Promise<(Assignment & { design: string | null; seedDigest: string })[]> {
  const rows = await query<{
    sid: string; arm: string; stratum: string | null; cluster_key: string | null;
    design: string | null; seed_digest: string;
  }>(
    `SELECT a.sid, a.arm, a.stratum, a.cluster_key, a.design, a.seed_digest
       FROM experiment_assignments a
       JOIN cohorts c ON c.id = a.cohort_id
      WHERE a.cohort_id = $1 AND c.project_id = $2
      ORDER BY a.sid`,
    [cohortId, projectId],
  );
  return rows.map((r) => ({
    sid: r.sid, arm: r.arm, stratum: r.stratum, clusterKey: r.cluster_key,
    design: r.design, seedDigest: r.seed_digest,
  }));
}

/**
 * 寄せ（sid_aliases）によって生じた食い違いを拾う（設計 §13-11）。
 *
 * **割付のやり直しはしない。** 事前登録と矛盾するため。ここでやるのは、
 * 評価の前に「この群の人数は額面どおりではない」と見えるようにすること。
 */
export async function findMergeConflicts(
  projectId: string,
  cohortId: string,
): Promise<MergeConflict[]> {
  const assignments = await query<{ sid: string; arm: string }>(
    `SELECT a.sid, a.arm FROM experiment_assignments a
       JOIN cohorts c ON c.id = a.cohort_id
      WHERE a.cohort_id = $1 AND c.project_id = $2`,
    [cohortId, projectId],
  );
  if (assignments.length === 0) return [];

  const subjects = await query<{ sid: string; canonical_sid: string }>(
    `SELECT sid, canonical_sid FROM subjects WHERE project_id = $1 AND sid <> canonical_sid`,
    [projectId],
  );
  if (subjects.length === 0) return [];

  const canonicalOf = new Map(subjects.map((s) => [s.sid, s.canonical_sid]));
  return detectMergeConflicts(assignments, canonicalOf);
}
