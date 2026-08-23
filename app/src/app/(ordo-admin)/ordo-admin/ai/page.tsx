export const dynamic = "force-dynamic";

import { query } from "@/lib/db";
import AiManagementClient, {
  type RoutingRow,
  type UsageByTask,
  type UsageByDay,
  type GroundingStat,
  type CorpusCounts,
} from "./AiManagementClient";

/**
 * 独自AI管理 — X1/X5（Coe内の運営管理画面）
 *
 * AIゲートウェイのタスク別ルーティング（独自AIへの段階移行のダイヤル）と
 * 利用状況モニタ。認可は (ordo-admin)/layout.tsx が担う（Ordo管理者のみ）。
 * 更新は /api/ordo-admin/ai/routing（セッション認可経路）を使う。
 */
export default async function OrdoAiPage() {
  // 接地状況（X6）。041 未実行でも画面が落ちないよう握る
  let groundingStats: GroundingStat[] = [];
  try {
    groundingStats = await query<GroundingStat>(
      `SELECT task_type, mode,
              count(*)::int AS groundings,
              count(*) FILTER (WHERE cardinality(corpus_measure_ids) > 0
                               OR cardinality(corpus_evidence_ids) > 0)::int AS with_hits,
              count(*) FILTER (WHERE injected)::int AS injected,
              count(*) FILTER (WHERE adopted IS TRUE)::int AS adopted
       FROM ai_grounding_logs
       WHERE occurred_at >= now() - interval '30 days'
       GROUP BY 1, 2 ORDER BY 1, 2`,
    );
  } catch {
    groundingStats = [];
  }

  let corpusCounts: CorpusCounts = {
    measures_approved: 0,
    measures_pending: 0,
    evidence_approved: 0,
    evidence_pending: 0,
  };
  try {
    const row = await query<CorpusCounts>(
      `SELECT
         (SELECT count(*) FROM corpus_measures WHERE status = 'approved')::int AS measures_approved,
         (SELECT count(*) FROM corpus_measures WHERE status = 'pending')::int  AS measures_pending,
         (SELECT count(*) FROM corpus_evidence WHERE status = 'approved')::int AS evidence_approved,
         (SELECT count(*) FROM corpus_evidence WHERE status = 'pending')::int  AS evidence_pending`,
    );
    if (row[0]) corpusCounts = row[0];
  } catch {
    /* 040 未実行時はゼロのまま */
  }

  const [routing, usageByTask, usageByDay] = await Promise.all([
    query<RoutingRow>(
      `SELECT task_type, mode, ordo_weight, note, updated_at::text
       FROM ai_task_routing ORDER BY task_type`,
    ),
    query<UsageByTask>(
      `SELECT task_type,
              provider,
              count(*)::int                                    AS calls,
              count(*) FILTER (WHERE status = 'error')::int    AS errors,
              COALESCE(sum(input_tokens), 0)::float            AS input_tokens,
              COALESCE(sum(output_tokens), 0)::float           AS output_tokens,
              COALESCE(round(avg(latency_ms)), 0)::int         AS avg_latency_ms
       FROM ai_usage_logs
       WHERE occurred_at >= now() - interval '30 days'
       GROUP BY task_type, provider
       ORDER BY calls DESC`,
    ),
    query<UsageByDay>(
      `SELECT occurred_at::date::text AS day,
              count(*)::int           AS calls,
              count(*) FILTER (WHERE status = 'error')::int AS errors
       FROM ai_usage_logs
       WHERE occurred_at >= now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
    ),
  ]);

  return (
    <AiManagementClient
      initialRouting={routing}
      usageByTask={usageByTask}
      usageByDay={usageByDay}
      groundingStats={groundingStats}
      corpusCounts={corpusCounts}
    />
  );
}
