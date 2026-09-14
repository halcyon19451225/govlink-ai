/**
 * 対話からの提案 — サービス層（設計: claude/coe-dataset-model.md §10-3・§10-5）
 *
 * 規律（check:proposal が構造で固定する）:
 *   ① **提案は何も作らない。** ターンの確定処理が呼べるのは recordProposals() だけで、
 *      この関数はデータセットも指標も作らない
 *   ② **承認だけが作る。** approveProposal() は画面と同じサービス関数
 *      （createDatasetTx / createIndicatorTx）を、同じ検証を通って呼ぶ
 *   ③ **決めるのは人。** decided_by は担当者。AI は決められない
 *   ④ 見送った提案も消さない（何を提案され、なぜ採らなかったかが残る）
 *
 * ★ この層は分野に依存しない。特定の行政分野の語彙を書かないこと（check:generic）。
 */
import { query, queryOne, transaction } from "@/lib/db";
import { logActivity, type Actor } from "@/lib/activity";
import { createDatasetTx } from "@/lib/dataset/service";
import { createIndicatorTx } from "@/lib/indicator/service";
import { validateSpec } from "@/lib/indicator/spec";
import {
  proposalBlockers,
  type DialogueKind,
  type Proposal,
  type ProposalRow,
} from "./types";
import { isDataAware, pushPendingInputs, setWaiting } from "./dataReady";

export class ProposalError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

/** 別名を付けて読むとき（JOIN する SELECT 用） */
const ROW_COLS = `p.id, p.project_id, p.dialogue_kind, p.dialogue_id, p.turn_no, p.ref, p.kind,
  p.payload, p.status, p.decided_by, p.decided_at::text AS decided_at, p.decline_reason,
  p.dataset_id, p.indicator_id, p.created_at::text AS created_at`;
/** RETURNING 用（別名を付けられない） */
const RETURN_COLS = `id, project_id, dialogue_kind, dialogue_id, turn_no, ref, kind,
  payload, status, decided_by, decided_at::text AS decided_at, decline_reason,
  dataset_id, indicator_id, created_at::text AS created_at`;

/**
 * その対話の提案を並べる。承認済みの箱については「まだ待っているか」も返す
 * （画面が「アップロードしてください」を出すのに使う）。
 */
export async function listProposals(
  projectId: string,
  dialogueKind: DialogueKind,
  dialogueId: string,
): Promise<ProposalRow[]> {
  return query<ProposalRow>(
    `SELECT ${ROW_COLS},
            CASE WHEN p.kind = 'dataset' AND p.status = 'approved'
                 THEN NOT EXISTS (SELECT 1 FROM dataset_versions v
                                   WHERE v.dataset_id = p.dataset_id AND v.status = 'validated')
                 ELSE false END AS awaiting_upload,
            (SELECT max(v.as_of)::text FROM dataset_versions v
              WHERE v.dataset_id = p.dataset_id AND v.status = 'validated') AS latest_as_of
       FROM dialogue_proposals p
      WHERE p.project_id = $1 AND p.dialogue_kind = $2 AND p.dialogue_id = $3
      ORDER BY p.created_at`,
    [projectId, dialogueKind, dialogueId],
  );
}

/** 計画全体の未決の提案（対話の一覧にバッジを出すのに使う） */
export async function countPendingProposals(
  projectId: string,
): Promise<{ dialogue_id: string; pending: number }[]> {
  return query<{ dialogue_id: string; pending: number }>(
    `SELECT dialogue_id, count(*)::int AS pending
       FROM dialogue_proposals
      WHERE project_id = $1 AND status = 'pending'
      GROUP BY dialogue_id`,
    [projectId],
  );
}

/**
 * ターンの確定処理から呼ぶ。**提案を1行として残すだけで、何も作らない。**
 * 同じ ref を何度出されても増えない（AI が言い直しても提案が積み上がらない）。
 */
export async function recordProposals(
  actor: Actor,
  projectId: string,
  dialogueKind: DialogueKind,
  dialogueId: string,
  turnNo: number,
  proposals: Proposal[],
): Promise<ProposalRow[]> {
  if (proposals.length === 0) return [];
  const out: ProposalRow[] = [];
  for (const p of proposals) {
    const r = await query<ProposalRow>(
      `INSERT INTO dialogue_proposals
         (project_id, dialogue_kind, dialogue_id, turn_no, ref, kind, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dialogue_id, ref) DO NOTHING
       RETURNING ${RETURN_COLS}`,
      [projectId, dialogueKind, dialogueId, turnNo, p.ref, p.kind, JSON.stringify(p)],
    );
    const row = r[0];
    if (!row) continue;
    await logActivity(null, {
      projectId,
      actor,
      entity: "proposal",
      entityId: row.id,
      action: "create",
      summary: { kind: p.kind, ref: p.ref, label: p.kind === "dataset" ? p.name : p.label },
    });
    out.push(row);
  }
  return out;
}

async function getProposal(
  projectId: string,
  proposalId: string,
): Promise<ProposalRow | null> {
  return queryOne<ProposalRow>(
    `SELECT ${ROW_COLS} FROM dialogue_proposals p WHERE p.id = $1 AND p.project_id = $2`,
    [proposalId, projectId],
  );
}

export interface ApproveResult {
  proposal: ProposalRow;
  datasetId: string | null;
  indicatorId: string | null;
  /** データが上がるのを待つ状態になったか */
  waiting: boolean;
}

/**
 * 承認して登録する。**ここだけが実体を作る。**
 *
 * 箱と指標は同じトランザクションで作る（指標だけ残って箱が無い、の逆も起きないように）。
 * 作成者は承認した担当者、経路は via='dialogue'。画面から作ったものと同じ表の同じ形になり、
 * 違いは created_via / activity_log.via の1列だけ（設計 §10-5）。
 */
export async function approveProposal(
  actor: Actor,
  projectId: string,
  proposalId: string,
): Promise<ApproveResult> {
  const p = await getProposal(projectId, proposalId);
  if (!p) throw new ProposalError("提案が見つかりません", 404);
  if (p.status === "approved") throw new ProposalError("この提案は承認済みです", 409);
  if (p.status === "declined") throw new ProposalError("この提案は見送られています", 409);
  if (!actor.userRoleId) throw new ProposalError("承認する担当者が分かりません", 400);

  const payload = p.payload;
  const blockers = proposalBlockers(payload);
  if (blockers.length > 0) throw new ProposalError(`このままでは登録できません: ${blockers.join("・")}`);

  const result = await transaction(async (client) => {
    let datasetId: string | null = null;
    let indicatorId: string | null = null;

    if (payload.kind === "dataset") {
      const ds = await createDatasetTx(client, actor, projectId, {
        kind: "aggregate",
        name: payload.name,
        description: payload.why || null,
        templateId: payload.templateId,
        columnSchema: payload.columns.map((c) => ({ name: c.name, role: c.role, type: c.type as never })),
        timeGranularity: payload.timeGranularity,
      });
      datasetId = ds.id;
    } else {
      // 依存する箱が承認済みなら、その id を設定に差し込む。
      // 提案の時点では箱がまだ無いので、AI は datasetId を書けない
      const spec: Record<string, unknown> = { ...payload.spec };
      if (payload.dependsOn) {
        const dep = await client.query<{ dataset_id: string | null; status: string }>(
          `SELECT dataset_id, status FROM dialogue_proposals
            WHERE dialogue_id = $1 AND ref = $2`,
          [p.dialogue_id, payload.dependsOn],
        );
        const depRow = dep.rows[0];
        if (!depRow || depRow.status !== "approved" || !depRow.dataset_id) {
          throw new ProposalError("先に、この指標が使うデータセットの提案を承認してください");
        }
        spec["datasetId"] = depRow.dataset_id;
      }
      if (payload.calcType !== "manual") {
        const errs = validateSpec(spec);
        if (errs.length > 0) throw new ProposalError(`指標の設定が未完成です: ${errs[0]}`);
      }
      const ind = await createIndicatorTx(client, actor, projectId, {
        label: payload.label,
        unit: payload.unit,
        description: payload.why || null,
        calcType: payload.calcType,
        origin: "dialogue",
        ...(payload.calcType !== "manual" ? { spec } : {}),
      });
      indicatorId = ind.id;
    }

    const r = await client.query<ProposalRow>(
      `UPDATE dialogue_proposals
          SET status = 'approved', decided_by = $1, decided_at = now(),
              dataset_id = $2, indicator_id = $3
        WHERE id = $4 AND project_id = $5 AND status = 'pending'
        RETURNING ${RETURN_COLS}`,
      [actor.userRoleId, datasetId, indicatorId, proposalId, projectId],
    );
    const updated = r.rows[0];
    // 同時に2回押された場合。実体を作ってしまわないようロールバックする
    if (!updated) throw new ProposalError("この提案は既に処理されています", 409);

    await logActivity(client, {
      projectId,
      actor,
      entity: "proposal",
      entityId: proposalId,
      action: "update",
      summary: {
        decision: "approved",
        kind: payload.kind,
        ref: payload.ref,
        dataset_id: datasetId,
        indicator_id: indicatorId,
      },
    });
    return { proposal: updated, datasetId, indicatorId };
  });

  // 箱を作ったなら、データが上がるのを待つ状態にする。
  // **待機はブロックではない** — 担当者は待っている間も対話を続けられる（設計 §10-3）
  let waiting = false;
  if (result.datasetId && isDataAware(p.dialogue_kind)) {
    const has = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM dataset_versions WHERE dataset_id = $1 AND status = 'validated'`,
      [result.datasetId],
    );
    waiting = (has?.n ?? 0) === 0;
    if (waiting) await setWaiting(p.dialogue_kind, p.dialogue_id, projectId, true);
  }

  if (isDataAware(p.dialogue_kind)) {
    await pushPendingInputs(p.dialogue_kind, p.dialogue_id, projectId, [
      {
        kind: "approved",
        text:
          payload.kind === "dataset"
            ? `担当者が「${payload.name}」の登録を承認しました。${
                payload.asOfNeeded ? `${payload.asOfNeeded} 時点の` : ""
              }データのアップロード待ちです。`
            : `担当者が指標「${payload.label}」の登録を承認しました。`,
        at: new Date().toISOString(),
      },
    ]);
  }

  return { ...result, waiting };
}

/** 見送る。行は消さない（何を提案され、なぜ採らなかったかを残す） */
export async function declineProposal(
  actor: Actor,
  projectId: string,
  proposalId: string,
  reason: string | null,
): Promise<ProposalRow> {
  const p = await getProposal(projectId, proposalId);
  if (!p) throw new ProposalError("提案が見つかりません", 404);
  if (p.status !== "pending") throw new ProposalError("この提案は既に処理されています", 409);
  if (!actor.userRoleId) throw new ProposalError("見送りを決めた担当者が分かりません", 400);

  const row = await transaction(async (client) => {
    const r = await client.query<ProposalRow>(
      `UPDATE dialogue_proposals
          SET status = 'declined', decided_by = $1, decided_at = now(), decline_reason = $2
        WHERE id = $3 AND project_id = $4 AND status = 'pending'
        RETURNING ${RETURN_COLS}`,
      [actor.userRoleId, reason?.trim() || null, proposalId, projectId],
    );
    const updated = r.rows[0];
    if (!updated) throw new ProposalError("この提案は既に処理されています", 409);
    await logActivity(client, {
      projectId,
      actor,
      entity: "proposal",
      entityId: proposalId,
      action: "update",
      summary: { decision: "declined", kind: p.kind, ref: p.payload.ref, reason: reason ?? null },
    });
    return updated;
  });

  if (isDataAware(p.dialogue_kind)) {
    await pushPendingInputs(p.dialogue_kind, p.dialogue_id, projectId, [
      {
        kind: "declined",
        text: `担当者が「${p.kind === "dataset" ? (p.payload as { name: string }).name : (p.payload as { label: string }).label}」の提案を見送りました。${
          reason ? `理由: ${reason}` : "別の方法を検討してください。"
        }`,
        at: new Date().toISOString(),
      },
    ]);
  }
  return row;
}
