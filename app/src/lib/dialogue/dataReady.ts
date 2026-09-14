/**
 * 「待っていたデータが上がった」の後始末 — 設計: claude/coe-dataset-model.md §10-3
 *
 * 再開の入口は2つある（設計 §15-7）:
 *   (a) 担当者が「上げました」と対話に送る      → refreshDataWaits()
 *   (b) 版が validated になった                 → notifyDatasetVersionValidated()
 *
 * **どちらも同じ settleWaits() を通る。** 経路で結果が変わらないようにするため
 * （人が言っても、取込が知らせても、同じ計算をして同じ履歴が残る）。
 *
 * 値を計算する actor は**そのきっかけを作った担当者**（送った人・上げた人）で、
 * AI ではない（設計 §10-5）。経路は via='dialogue'。
 *
 * ★ この層は分野に依存しない。特定の行政分野の語彙を書かないこと（check:generic）。
 */
import { query } from "@/lib/db";
import type { Actor } from "@/lib/activity";
import { computeAndRecord, latestValue, IndicatorError } from "@/lib/indicator/service";
import { describeMissing } from "@/lib/indicator/spec";
import type { DialogueKind, PendingInput } from "./types";

/** 対話ごとの置き場（表と列）。対話を増やすときはここに足す */
const DIALOGUE_TABLE: Record<DialogueKind, string> = {
  measure: "measure_dialogues",
  asis: "asis_analyses",
  issue: "issue_dialogues",
  improvement: "improvement_dialogues",
};

/** いまデータ行を積める対話（列を足した対話だけ。D6 は施策構築だけ・設計 §15-8） */
export const DATA_AWARE_DIALOGUES: DialogueKind[] = ["measure"];

export function isDataAware(kind: DialogueKind): boolean {
  return DATA_AWARE_DIALOGUES.includes(kind);
}

function tableFor(kind: DialogueKind): string {
  if (!isDataAware(kind)) throw new Error(`この対話はまだデータ行を扱えません: ${kind}`);
  return DIALOGUE_TABLE[kind];
}

/** データ行を1件以上積む（差し込みは次のターンの冒頭） */
export async function pushPendingInputs(
  kind: DialogueKind,
  dialogueId: string,
  projectId: string,
  inputs: PendingInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  await query(
    `UPDATE ${tableFor(kind)}
        SET pending_inputs = pending_inputs || $1::jsonb, updated_at = now()
      WHERE id = $2 AND project_id = $3`,
    [JSON.stringify(inputs), dialogueId, projectId],
  );
}

/**
 * 待機の状態を置く／解く。**対話の表の対応はこのファイルに閉じる**
 * （呼び出し側が表の名前を直に書くと、対話を増やしたときに直し漏れる）。
 */
export async function setWaiting(
  kind: DialogueKind,
  dialogueId: string,
  projectId: string,
  waiting: boolean,
): Promise<void> {
  await query(
    `UPDATE ${tableFor(kind)} SET data_state = $1, updated_at = now()
      WHERE id = $2 AND project_id = $3`,
    [waiting ? "waiting_for_data" : "none", dialogueId, projectId],
  );
}

/** 差し込んだデータ行を取り出して空にする（同じ行を二度差し込まない） */
export async function takePendingInputs(
  kind: DialogueKind,
  dialogueId: string,
  projectId: string,
): Promise<PendingInput[]> {
  const rows = await query<{ pending_inputs: PendingInput[] }>(
    `UPDATE ${tableFor(kind)} SET pending_inputs = '[]'::jsonb
      WHERE id = $1 AND project_id = $2 AND pending_inputs <> '[]'::jsonb
      RETURNING pending_inputs`,
    [dialogueId, projectId],
  );
  return rows[0]?.pending_inputs ?? [];
}

interface WaitRow {
  proposal_id: string;
  dialogue_kind: DialogueKind;
  dialogue_id: string;
  project_id: string;
  ref: string;
  dataset_id: string;
  dataset_name: string;
  latest_as_of: string | null;
}

/**
 * 承認済みの箱のうち、**有効な版が上がったもの**を拾う。
 * `rejected` の版は数えない（取り込まれていないので、指標は計算できない）。
 */
async function readyWaits(projectId: string, datasetId: string | null): Promise<WaitRow[]> {
  return query<WaitRow>(
    `SELECT p.id AS proposal_id, p.dialogue_kind, p.dialogue_id, p.project_id, p.ref,
            p.dataset_id, d.name AS dataset_name,
            (SELECT max(v.as_of)::text FROM dataset_versions v
              WHERE v.dataset_id = p.dataset_id AND v.status = 'validated') AS latest_as_of
       FROM dialogue_proposals p
       JOIN datasets d ON d.id = p.dataset_id
      WHERE p.project_id = $1 AND p.kind = 'dataset' AND p.status = 'approved'
        AND ($2::uuid IS NULL OR p.dataset_id = $2::uuid)
        AND EXISTS (SELECT 1 FROM dataset_versions v
                     WHERE v.dataset_id = p.dataset_id AND v.status = 'validated')`,
    [projectId, datasetId],
  );
}

/** その箱の提案に依存している、承認済みの指標 */
async function dependentIndicators(
  dialogueId: string,
  ref: string,
): Promise<{ indicator_id: string; label: string }[]> {
  return query<{ indicator_id: string; label: string }>(
    `SELECT p.indicator_id, i.label
       FROM dialogue_proposals p
       JOIN indicators i ON i.id = p.indicator_id
      WHERE p.dialogue_id = $1 AND p.kind = 'indicator' AND p.status = 'approved'
        AND p.indicator_id IS NOT NULL
        AND (p.payload->>'dependsOn') = $2`,
    [dialogueId, ref],
  );
}

/** まだ版が上がっていない、承認済みの箱が残っているか */
async function stillWaiting(dialogueId: string): Promise<boolean> {
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM dialogue_proposals p
      WHERE p.dialogue_id = $1 AND p.kind = 'dataset' AND p.status = 'approved'
        AND NOT EXISTS (SELECT 1 FROM dataset_versions v
                         WHERE v.dataset_id = p.dataset_id AND v.status = 'validated')`,
    [dialogueId],
  );
  return (rows[0]?.n ?? 0) > 0;
}

export interface SettleResult {
  /** データ行を積んだ対話 */
  dialogueIds: string[];
  computed: number;
  missing: number;
}

/**
 * 上がった箱を見て、依存している指標を計算し、結果をデータ行として積む。
 * **再開の2つの入口は、どちらもここを通る。**
 */
async function settleWaits(
  actor: Actor,
  projectId: string,
  opts: { datasetId?: string | null; dialogueId?: string | null } = {},
): Promise<SettleResult> {
  const waits = (await readyWaits(projectId, opts.datasetId ?? null)).filter(
    (w) => !opts.dialogueId || w.dialogue_id === opts.dialogueId,
  );
  const touched = new Set<string>();
  let computed = 0;
  let missing = 0;

  for (const w of waits) {
    if (!isDataAware(w.dialogue_kind)) continue;
    const deps = await dependentIndicators(w.dialogue_id, w.ref);
    const asOf = w.latest_as_of;
    if (!asOf) continue;
    const inputs: PendingInput[] = [
      {
        kind: "data_ready",
        text: `「${w.dataset_name}」に ${asOf} 時点の版が登録されました。`,
        at: new Date().toISOString(),
      },
    ];

    for (const dep of deps) {
      try {
        const r = await computeAndRecord(actor, projectId, dep.indicator_id, asOf);
        if (r.ok) {
          computed++;
          inputs.push({
            kind: "indicator_value",
            text: `指標「${r.label}」の ${asOf} 時点の値は ${r.value} です（計算して履歴に記録しました）。`,
            at: new Date().toISOString(),
          });
        } else {
          missing++;
          inputs.push({
            kind: "missing",
            text: `指標「${r.label}」はまだ計算できません: ${r.missing.map(describeMissing).join(" / ")}`,
            at: new Date().toISOString(),
          });
        }
      } catch (e) {
        missing++;
        inputs.push({
          kind: "missing",
          text: `指標「${dep.label}」の計算に失敗しました: ${
            e instanceof IndicatorError ? e.message : "設定を確認してください"
          }`,
          at: new Date().toISOString(),
        });
      }
    }

    await pushPendingInputs(w.dialogue_kind, w.dialogue_id, projectId, inputs);
    touched.add(w.dialogue_id);

    // 待っている箱が無くなったら、待機を解く
    if (!(await stillWaiting(w.dialogue_id))) {
      await setWaiting(w.dialogue_kind, w.dialogue_id, projectId, false);
    }
  }

  return { dialogueIds: Array.from(touched), computed, missing };
}

/**
 * (b) 版が validated になったときに呼ぶ。**取込のサービス関数から呼ばれる**ので、
 * 画面から上げても、将来ほかの経路から上げても、必ず通る。
 */
export async function notifyDatasetVersionValidated(
  actor: Actor,
  projectId: string,
  datasetId: string,
): Promise<SettleResult> {
  try {
    return await settleWaits(actor, projectId, { datasetId });
  } catch (e) {
    // 取込そのものは成功している。待機の解除に失敗しても版は残す
    // （担当者が「上げました」と送れば (a) の経路で同じ処理が走る）
    console.error("[dataReady] 待機の解除に失敗しました", e instanceof Error ? e.message : e);
    return { dialogueIds: [], computed: 0, missing: 0 };
  }
}

/**
 * (a) 担当者が対話に発言したときに呼ぶ。
 * 「上げました」と言われたかどうかを**言葉で判定しない**（言い方は人それぞれで、
 * 判定を外すと再開できなくなる）。版が上がっていれば、何を言われても再開する。
 */
export async function refreshDataWaits(
  actor: Actor,
  projectId: string,
  dialogueKind: DialogueKind,
  dialogueId: string,
): Promise<SettleResult> {
  return settleWaits(actor, projectId, { dialogueId });
}

/**
 * AI が「この値が要る」と書いたものに答える（設計 §10-2）。
 * ターンの確定後に計算し、**結果は次のターンの冒頭に差し込む**。
 */
export async function resolveIndicatorRequests(
  actor: Actor,
  projectId: string,
  dialogueKind: DialogueKind,
  dialogueId: string,
  requests: { indicatorId: string | null; label: string | null; asOf: string | null }[],
  defaultAsOf: string,
): Promise<PendingInput[]> {
  const inputs: PendingInput[] = [];
  for (const req of requests) {
    const asOf = req.asOf ?? defaultAsOf;
    let found: { id: string; label: string; calc_type: string } | null = null;
    if (req.indicatorId) {
      const rows = await query<{ id: string; label: string; calc_type: string }>(
        `SELECT id, label, calc_type FROM indicators WHERE id = $1 AND project_id = $2`,
        [req.indicatorId, projectId],
      );
      found = rows[0] ?? null;
    }
    if (!found && req.label) {
      const rows = await query<{ id: string; label: string; calc_type: string }>(
        `SELECT id, label, calc_type FROM indicators
          WHERE project_id = $1 AND lower(label) = lower($2) ORDER BY created_at LIMIT 1`,
        [projectId, req.label],
      );
      found = rows[0] ?? null;
    }
    if (!found) {
      inputs.push({
        kind: "missing",
        text: `指標「${req.label ?? req.indicatorId}」は登録されていません。必要なら提案してください（承認されると登録されます）。`,
        at: new Date().toISOString(),
      });
      continue;
    }
    if (found.calc_type === "manual") {
      const v = await latestValue(found.id);
      inputs.push(
        v
          ? {
              kind: "indicator_value",
              text: `指標「${found.label}」は手入力です。記録されている最新の値は ${v.value ?? v.value_text}（${v.as_of} 時点）です。`,
              at: new Date().toISOString(),
            }
          : {
              kind: "missing",
              text: `指標「${found.label}」は手入力で、まだ値が入っていません。`,
              at: new Date().toISOString(),
            },
      );
      continue;
    }
    try {
      const r = await computeAndRecord(actor, projectId, found.id, asOf);
      inputs.push(
        r.ok
          ? {
              kind: "indicator_value",
              text: `指標「${r.label}」の ${asOf} 時点の値は ${r.value} です。`,
              at: new Date().toISOString(),
            }
          : {
              kind: "missing",
              text: `指標「${r.label}」はまだ計算できません: ${r.missing.map(describeMissing).join(" / ")}`,
              at: new Date().toISOString(),
            },
      );
    } catch (e) {
      inputs.push({
        kind: "missing",
        text: `指標「${found.label}」の計算に失敗しました: ${
          e instanceof IndicatorError ? e.message : "設定を確認してください"
        }`,
        at: new Date().toISOString(),
      });
    }
  }
  if (inputs.length > 0) await pushPendingInputs(dialogueKind, dialogueId, projectId, inputs);
  return inputs;
}
