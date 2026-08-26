export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { requireModulePermission } from "@/lib/permissions";
import { reviseLogicModel } from "@/lib/logicmodel/revise";
import { LM_ELEMENT_SECTIONS } from "@/lib/plan/clone";
import { sanitizeIntakeProposals, type IntakeProposal } from "@/lib/plan/handoverIntake";

type Params = { params: { id: string } };

const MODULE = "self_evaluation";

/**
 * 選別済みの引き継ぎ反映を一括適用（PL1 P② 経路1）
 *
 * POST { handover_id, proposals: IntakeProposal[] }
 * - 1トランザクション（失敗時は全ロールバック）
 * - サーバー側で再サニタイズ（クライアントの提案をそのまま信じない）
 * - LM修正は **L5のrevise（版複製）で改訂版を1つ起こしてから**適用 —
 *   現行版を直接上書きしない（改訂前後が版として残る）
 * - すべて「どの引き継ぎから来たか」を記録（plan_handover_id / revision_reason / 反映マーク）
 * - 適用後 plan_handovers.status → consumed（既存の状態遷移をそのまま使う）
 */
const bodySchema = z.object({
  handover_id: z.string().uuid(),
  proposals: z.array(z.record(z.string(), z.unknown())).min(1).max(30),
});

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, MODULE, "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  // サーバー側で再サニタイズ（実在IDのセットで検証）
  const [measureRows, kpiRows] = await Promise.all([
    query<{ id: string }>(`SELECT id FROM measure_designs WHERE project_id = $1`, [params.id]),
    query<{ id: string }>(`SELECT id FROM kpis WHERE project_id = $1`, [params.id]),
  ]);
  const { proposals } = sanitizeIntakeProposals(
    { proposals: parsed.data.proposals },
    {
      measureIds: new Set(measureRows.map((r) => r.id)),
      kpiIds: new Set(kpiRows.map((r) => r.id)),
    },
  );
  if (proposals.length === 0) {
    return NextResponse.json({ data: null, error: "適用可能な提案がありません" }, { status: 400 });
  }

  try {
    const result = await transaction(async (client) => {
      const handover = await client.query<{ id: string; title: string; status: string }>(
        `SELECT id, title, status FROM plan_handovers
         WHERE id = $1 AND target_project_id = $2 FOR UPDATE`,
        [parsed.data.handover_id, params.id],
      );
      const h = handover.rows[0];
      if (!h) throw new Error("引き継ぎパッケージが見つかりません");

      const counts = { lm_edits: 0, measure_updates: 0, kpi_targets: 0, improvement_actions: 0 };
      let lmVersion: number | null = null;

      // ── ロジックモデル: 改訂版を起こしてから修正を適用 ──
      const lmEdits = proposals.filter(
        (p): p is Extract<IntakeProposal, { type: "lm_element_edit" }> => p.type === "lm_element_edit",
      );
      if (lmEdits.length > 0) {
        const revised = await reviseLogicModel(client, {
          projectId: params.id,
          reason: `前期引き継ぎの取込（${h.title}）`,
        });
        if (!revised) throw new Error("ロジックモデルの改訂版を作成できませんでした");
        lmVersion = revised.version;

        const secList = LM_ELEMENT_SECTIONS.map((s) => `"${s}"`).join(", ");
        const lmRow = await client.query(`SELECT ${secList} FROM logic_models WHERE id = $1`, [revised.id]);
        const row = lmRow.rows[0] as Record<string, unknown>;
        for (const edit of lmEdits) {
          const arr = Array.isArray(row[edit.section]) ? ([...(row[edit.section] as unknown[])]) : [];
          let applied = false;
          if (edit.element_id) {
            for (let i = 0; i < arr.length; i++) {
              const el = arr[i];
              if (el && typeof el === "object" && (el as Record<string, unknown>)["id"] === edit.element_id) {
                arr[i] = { ...(el as Record<string, unknown>), text: edit.new_text };
                applied = true;
                break;
              }
            }
          }
          if (!applied) {
            arr.push({ id: `ho-${randomUUID().slice(0, 8)}`, text: edit.new_text, kpi_ids: [] });
          }
          row[edit.section] = arr;
          counts.lm_edits++;
        }
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const sec of LM_ELEMENT_SECTIONS) {
          vals.push(JSON.stringify(row[sec] ?? []));
          sets.push(`"${sec}" = $${vals.length}::jsonb`);
        }
        vals.push(revised.id);
        await client.query(`UPDATE logic_models SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
      }

      // ── 施策: B区画（intervention）/ D区画（experiment.rationale）へ反映 ──
      for (const p of proposals) {
        if (p.type !== "measure_update") continue;
        const mark = `\n\n【前期からの改善反映${p.from_action_title ? `（${p.from_action_title}）` : ""}${p.section === "experiment" ? "・実験設計の見直し案" : ""}】\n${p.proposal}`;
        if (p.section === "experiment") {
          // 実験計画がある場合は rationale に追記・無い場合は intervention に見直し案として残す
          await client.query(
            `UPDATE measure_designs SET
               experiment = CASE WHEN experiment IS NOT NULL
                 THEN jsonb_set(experiment, '{rationale}',
                        to_jsonb(COALESCE(experiment->>'rationale', '') || $1))
                 ELSE experiment END,
               intervention = CASE WHEN experiment IS NULL
                 THEN COALESCE(intervention, '') || $1 ELSE intervention END,
               updated_at = now()
             WHERE id = $2 AND project_id = $3`,
            [mark, p.measure_id, params.id],
          );
        } else {
          await client.query(
            `UPDATE measure_designs SET intervention = COALESCE(intervention, '') || $1, updated_at = now()
             WHERE id = $2 AND project_id = $3`,
            [mark, p.measure_id, params.id],
          );
        }
        counts.measure_updates++;
      }

      // ── KPI: 目標値・期限の見直し（数値提案があるときだけフラグを下ろす）──
      for (const p of proposals) {
        if (p.type !== "kpi_target") continue;
        await client.query(
          `UPDATE kpis SET
             target = COALESCE($1::numeric, target),
             target_deadline = COALESCE($2::date, target_deadline),
             target_needs_review = CASE WHEN $1::numeric IS NOT NULL THEN false ELSE target_needs_review END,
             updated_at = now()
           WHERE id = $3 AND project_id = $4`,
          [p.proposed_target, p.proposed_deadline, p.kpi_id, params.id],
        );
        counts.kpi_targets++;
      }

      // ── 改善アクション: source='handover' で起票（リネージFKつき）──
      for (const p of proposals) {
        if (p.type !== "improvement_action") continue;
        await client.query(
          `INSERT INTO improvement_actions
             (project_id, source, status, title, detail, root_cause, carry_over, plan_handover_id)
           VALUES ($1, 'handover', 'proposed', $2, $3, $4, false, $5)`,
          [params.id, p.title, p.detail, p.root_cause, h.id],
        );
        counts.improvement_actions++;
      }

      // ── 引き継ぎを consumed に（既存の状態遷移）──
      await client.query(
        `UPDATE plan_handovers SET status = 'consumed', consumed_at = now(), updated_at = now()
         WHERE id = $1`,
        [h.id],
      );

      return { counts, lm_version: lmVersion };
    });

    return NextResponse.json({ data: result, error: null });
  } catch (e) {
    console.error("引き継ぎ反映の適用に失敗:", e);
    return NextResponse.json(
      { data: null, error: e instanceof Error ? e.message : "適用に失敗しました（変更は巻き戻されています）" },
      { status: 500 },
    );
  }
}
