/**
 * 操作履歴 — 設計: claude/coe-dataset-model.md §10-5
 *
 * **画面（API ルート）も AI（対話の確定処理）も、必ず同じサービス関数を通る。**
 * 「AI 専用の近道」は作らない。作成・変更・算出・ダウンロードはすべてここに1行残り、
 * AI の操作でも actor は**その対話の担当者**（承認した人）になる。AI 自身を actor にはしない。
 *
 * 分野に依存しない層。ここに特定の行政分野の語彙を書かないこと（check:generic）。
 */
import type { PoolClient } from "pg";
import type { Session } from "next-auth";
import { query } from "@/lib/db";

/** どの経路からの操作か */
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

export type ActivityEntity =
  | "dataset"
  | "dataset_version"
  | "attribute"
  | "key_type"
  | "indicator"
  | "indicator_target"
  | "indicator_value";

export type ActivityAction =
  | "create"
  | "update"
  | "delete"
  | "ingest"
  | "compute"
  | "reject"
  | "download";

export interface ActivityEntry {
  projectId: string | null;
  actor: Actor;
  entity: ActivityEntity;
  entityId: string;
  action: ActivityAction;
  summary?: Record<string, unknown>;
}

/**
 * 操作を1行残す。トランザクションの中なら client を渡す（同じトランザクションで書く）。
 */
export async function logActivity(client: PoolClient | null, entry: ActivityEntry): Promise<void> {
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

/**
 * API ルート用。画面からの操作は via='ui'。
 * AI の確定処理は via='dialogue' と dialogueRef を渡す（actor は担当者のまま）。
 */
export function actorFromSession(
  session: Session,
  via: ActivityVia = "ui",
  dialogueRef?: Record<string, unknown>,
): Actor {
  return {
    userRoleId: session.user?.userRoleId ?? null,
    municipalityId: session.user?.municipalityId ?? "",
    via,
    ...(dialogueRef ? { dialogueRef } : {}),
  };
}

/** 画面・バッチから使う、セッションを持たない経路用（移行スクリプト等） */
export function systemActor(municipalityId: string, via: ActivityVia): Actor {
  return { userRoleId: null, municipalityId, via };
}
