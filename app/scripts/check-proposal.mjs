#!/usr/bin/env node
/**
 * 提案 → 承認 → 登録 → 待機 → 再開 の検査 — check:proposal（D6）
 *
 * 設計: claude/coe-dataset-model.md §10-2・§10-3・§10-5
 *
 * halcy さんの要求:
 *   「AI が『この指標が要る』と提案 → 担当者が承認 → データセットと指標を登録 →
 *     アップロード待ち → 再開」。そして
 *   「AI が操作しても人が画面から操作しても同じ状態・同じ履歴になる。AI 専用の経路を作らない」
 *
 * 人の注意で守るものは、次の実装で壊れる。守る規律を構造で固定する:
 *   ① **提案は何も作らない。** ターンの確定処理（chat route）は提案を記録するだけで、
 *      データセットも指標も作らない
 *   ② **承認だけが作る。** 承認は画面と同じサービス関数を通る
 *   ③ **決めるのは人。** 決定者は担当者（user_roles）で、AI ではない
 *   ④ **再開の2つの経路が同じ関数を通る。** 「人が言った」と「取込が知らせた」で
 *      結果が変わらない
 *   ⑤ 取込のイベントは**サービス層から**呼ばれる（画面のルートに置くと別経路で漏れる）
 *   ⑥ AI の出力は検証を通ってからでないと保存されない
 *   ⑦ 表の形（提案の状態・決定者・待機・次ターンへのデータ行）
 *
 * 使い方: node scripts/check-proposal.mjs
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
const SRC = join(APP_ROOT, "src");

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (detail) console.error(`      ${detail}`);
  }
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
/** コメントを落とす。**規律は実装に掛ける** — 注記に書いた言葉で検査が落ちないように */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CHAT_ROUTE = "app/api/admin/projects/[id]/measure-dialogue/[dialogueId]/chat/route.ts";
const APPROVE_ROUTE =
  "app/api/admin/projects/[id]/measure-dialogue/[dialogueId]/proposals/[proposalId]/route.ts";
const LIST_ROUTE = "app/api/admin/projects/[id]/measure-dialogue/[dialogueId]/proposals/route.ts";

const chat = read(join(SRC, CHAT_ROUTE));
const approve = read(join(SRC, APPROVE_ROUTE));
const list = read(join(SRC, LIST_ROUTE));
const svc = read(join(SRC, "lib", "dialogue", "service.ts"));
const ready = read(join(SRC, "lib", "dialogue", "dataReady.ts"));
const types = read(join(SRC, "lib", "dialogue", "types.ts"));
const datasetSvc = read(join(SRC, "lib", "dataset", "service.ts"));
const prompt = read(join(SRC, "lib", "measure", "prompt.ts"));
const panel = read(join(SRC, "components", "measure", "MeasureDialoguePanel.tsx"));

// ── 1. 置き場 ─────────────────────────────────────────
console.log("1. 置き場");
check("lib/dialogue/types.ts がある（純関数の検証）", types.length > 0);
check("lib/dialogue/service.ts がある（提案のサービス層）", svc.length > 0);
check("lib/dialogue/dataReady.ts がある（待機と再開）", ready.length > 0);
check("提案の一覧 API がある", list.length > 0);
check("提案の承認 API がある", approve.length > 0);

// ── 2. 提案は何も作らない ─────────────────────────────
console.log("2. 提案は承認なしに何も作らない");
check(
  "ターンの確定処理は提案を記録するだけ（recordProposals を呼ぶ）",
  /recordProposals\(/.test(chat),
);
check(
  "ターンの確定処理がデータセットを作っていない",
  !/createDataset(Tx)?\(/.test(chat),
  "chat route から createDataset を呼んでいる（承認を経ずに作られる）",
);
check(
  "ターンの確定処理が指標を作っていない",
  !/createIndicator(Tx)?\(/.test(chat),
  "chat route から createIndicator を呼んでいる（承認を経ずに作られる）",
);
check(
  "提案の記録（recordProposals）がデータセット・指標を作らない",
  !/recordProposals[\s\S]*?createDatasetTx|recordProposals[\s\S]{0,1200}createIndicatorTx/.test(
    svc.slice(svc.indexOf("export async function recordProposals"), svc.indexOf("async function getProposal")),
  ),
);
check(
  "提案の初期状態が pending",
  /status\s+TEXT NOT NULL DEFAULT 'pending'/.test(migrations()),
);

// ── 3. 承認だけが作る。画面と同じサービス関数を通る ────
console.log("3. 承認だけが作る");
check("承認はデータセットのサービス関数を通る", /createDatasetTx\(/.test(svc));
check("承認は指標のサービス関数を通る", /createIndicatorTx\(/.test(svc));
check(
  "承認は箱と指標を同じトランザクションで作る",
  /transaction\(async \(client\) => \{/.test(svc) && /createDatasetTx\(client/.test(svc),
);
check(
  "承認の前に指標の設定を検証する（登録できたが計算できない指標を作らない）",
  /validateSpec\(/.test(svc),
);
check(
  "承認 API の actor はセッションの担当者",
  /actorFromSession\(session/.test(approve),
);
check("承認 API は via='dialogue' で記録する", /"dialogue"/.test(approve));
check(
  "承認 API は編集権限を要求する（実体が作られるため）",
  /requireModulePermission\(session, params\.id, "measure_design", "edit"\)/.test(approve),
);
check(
  "承認 API はテナント境界を見る",
  /requireProjectAccess\(session, params\.id\)/.test(approve),
);
check(
  "サービス層に生の INSERT INTO datasets / indicators が無い",
  !/INSERT INTO (datasets|indicators)\b/.test(svc),
);

// ── 4. 決めるのは人 ───────────────────────────────────
console.log("4. 決めるのは人");
check("決定者を必ず記録する（decided_by）", /decided_by/.test(svc));
check(
  "決定者が分からないときは承認できない",
  /if \(!actor\.userRoleId\) throw new ProposalError/.test(svc),
);
check(
  "決定者は user_roles を指す（AI ではない）",
  /decided_by\s+UUID REFERENCES user_roles\(id\)/.test(migrations()),
);
check(
  "見送った提案を消さない（status='declined' にする）",
  /status = 'declined'/.test(svc) && !/DELETE FROM dialogue_proposals/.test(svc),
);
check(
  "二重承認を弾く（status='pending' の行だけ更新する）",
  /AND status = 'pending'/.test(svc),
);

// ── 5. 再開の2経路が同じ関数を通る ────────────────────
console.log("5. 再開の2つの経路");
check("(a) 担当者の発言から再開する入口がある", /export async function refreshDataWaits/.test(ready));
check(
  "(b) 取込のイベントから再開する入口がある",
  /export async function notifyDatasetVersionValidated/.test(ready),
);
const settleCalls = (ready.match(/settleWaits\(/g) ?? []).length;
check(
  "2つの入口が同じ settleWaits を通る（経路で結果が変わらない）",
  settleCalls >= 3,
  `settleWaits の出現が ${settleCalls} 回（定義1＋呼び出し2以上を期待）`,
);
check("chat route が (a) を呼ぶ", /refreshDataWaits\(/.test(chat));
check(
  "取込のイベントは**サービス層**から呼ばれる（画面のルートではない）",
  /notifyDatasetVersionValidated\(/.test(datasetSvc),
  "lib/dataset/service.ts から呼ばれていない。ルートに置くと別経路で待機が解けない",
);
check(
  "有効な版のときだけ知らせる（rejected では知らせない）",
  /if \(!rejected\) \{\s*\n\s*await notifyDatasetVersionValidated/.test(datasetSvc),
);
check(
  "「上げました」という言い方で判定していない",
  !/上げました|アップロードしました/.test(stripComments(ready)),
  "言い方で再開を判定すると、言い方を変えられた瞬間に再開できなくなる",
);

// ── 6. AI の出力は検証を通る ──────────────────────────
console.log("6. AI の出力の検証");
check("提案の検証がある（sanitizeProposals）", /export function sanitizeProposals/.test(types));
check("値の要求の検証がある", /export function sanitizeIndicatorRequests/.test(types));
check("chat route が検証を通してから保存する", /sanitizeProposals\(/.test(chat));
check(
  "列定義の無い箱の提案は捨てる（行を取り込めず指標が計算できない）",
  /columns\.length === 0\) continue/.test(types),
);
check(
  "承認の前に「登録できるか」を確かめる関数がある",
  /export function proposalBlockers/.test(types),
);
check("画面が承認ボタンの手前で同じ検証を見せる", /proposalBlockers\(/.test(panel));
check(
  "個票の箱は対話から提案させない（鍵の運用が要る）",
  /kind: "aggregate"/.test(svc),
);

// ── 7. 値の要求は次のターンで返る ─────────────────────
console.log("7. 値の要求（ターンをまたぐ）");
check("要求を解決する関数がある", /export async function resolveIndicatorRequests/.test(ready));
check("chat route がターン確定後に解決する", /resolveIndicatorRequests\(/.test(chat));
check("結果は次のターンの冒頭に差し込まれる", /takePendingInputs\(/.test(chat));
check(
  "差し込んだデータ行は担当者の発言と区別される",
  /kind: "data"/.test(chat) && /m\.kind === "data"/.test(panel),
);
check(
  "指標の計算はサービス層（computeAndRecord）を通る",
  /computeAndRecord\(/.test(ready),
);
check(
  "AI 用の別の計算経路を作っていない",
  !/INSERT INTO indicator_values/.test(ready) && !/INSERT INTO indicator_values/.test(chat),
);

// ── 8. actor は AI ではない ───────────────────────────
console.log("8. actor");
check(
  "AI 処理の actor は対話の担当者（turn_actor）",
  /turn_actor/.test(chat) && /userRoleId: row\.turn_actor/.test(chat),
);
check("turn_actor は発言時に控える", /SET turn_actor = \$1/.test(chat));
check(
  "turn_actor は user_roles を指す",
  /turn_actor UUID REFERENCES user_roles\(id\)/.test(migrations()),
);

// ── 9. プロンプト ─────────────────────────────────────
console.log("9. プロンプト");
check("記録ツールに proposals がある", /proposals: \{/.test(prompt));
check("記録ツールに indicator_requests がある", /indicator_requests: \{/.test(prompt));
check(
  "「承認されるまで何も作られない」と AI に伝えている",
  /承認するまで何も作りません|承認されるまで何も作られない/.test(prompt),
);
check(
  "「このターンでは値は返らない」と AI に伝えている",
  /次のターンの冒頭/.test(prompt),
);
check(
  "指標の一覧（最新値つき）を毎ターン入れている",
  /【この計画の指標/.test(prompt),
);
check(
  "指標の一覧は可変部に置く（キャッシュの区切りより後ろ）",
  /const volatile = /.test(prompt) &&
    prompt.indexOf("indicatorBlock(indicatorContext") > prompt.indexOf("const volatile ="),
  "可変部に置かないと、毎ターン中身が変わって読み出しが当たらない",
);
check(
  "プロンプトは不変部と可変部を分けて返す",
  /\{ stable: string; volatile: string \}/.test(prompt),
);

// ── 10. 表の形 ────────────────────────────────────────
console.log("10. 表の形");
const migs = migrations();
check("dialogue_proposals を作るマイグレーションがある", /CREATE TABLE IF NOT EXISTS dialogue_proposals/.test(migs));
for (const col of ["dialogue_kind", "dialogue_id", "ref", "kind", "payload", "status", "decided_by", "dataset_id", "indicator_id"]) {
  check(`dialogue_proposals に ${col} がある`, new RegExp(`\\b${col}\\b`).test(migs));
}
check(
  "提案の状態の語彙が閉じている",
  /CHECK \(status IN \('pending', 'approved', 'declined'\)\)/.test(migs),
);
check(
  "同じ ref の提案は増えない（言い直しで積み上がらない）",
  /UNIQUE \(dialogue_id, ref\)/.test(migs),
);
check("待機の状態がある（data_state）", /data_state/.test(migs));
check(
  "待機の語彙が閉じている",
  /CHECK \(data_state IN \('none', 'waiting_for_data'\)\)/.test(migs),
);
check("次のターンへ渡すデータ行の置き場がある", /pending_inputs/.test(migs));
check("操作履歴の対象に提案が入っている", /proposal/.test(read(join(SRC, "lib", "activity.ts"))));

// ── 11. 待機はブロックではない ────────────────────────
console.log("11. 待機はブロックではない");
check(
  "待機中でも発言を止めていない",
  !/data_state === "waiting_for_data"[\s\S]{0,200}(disabled|return NextResponse)/.test(chat),
);
check(
  "画面が「待っている間も続けられる」と書いている",
  /待っている間も対話は続けられます/.test(panel),
);

function migrations() {
  const dir = join(REPO_ROOT, "infra", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => read(join(dir, f)))
    .join("\n");
}

console.log(`\ncheck:proposal — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
