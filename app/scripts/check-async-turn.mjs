#!/usr/bin/env node
/**
 * 対話AIターン非同期化の検査 — migration 055 / lib/ai/asyncTurn.ts
 *
 * この検査を作った理由:
 *   Amplify Hosting は API 応答を 30 秒で切る。AI処理を同期で待つ対話ルートが
 *   一つでも復活すると、サーバーは保存しているのに画面が「通信エラー」になる
 *   （2026-08-29 に課題仮説設定で実際に発生）。4対話すべてが
 *   「発言保存→202→自己呼び出し→ポーリング」の構造を保っていることをここで固定する。
 *
 * 使い方:
 *   node scripts/check-async-turn.mjs
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
const read = (p) => readFileSync(p, "utf8");

// ── 1. マイグレーション 055 が4テーブルに列を足している ──────────
const mig = join(REPO_ROOT, "infra", "migrations", "055_async_dialogue_turn.sql");
check("055_async_dialogue_turn.sql が存在する", existsSync(mig));
if (existsSync(mig)) {
  const sql = read(mig);
  for (const t of ["asis_analyses", "issue_dialogues", "measure_dialogues", "improvement_dialogues"]) {
    check(`055 が ${t} を対象にしている`, sql.includes(`'${t}'`));
  }
  for (const c of ["turn_status", "turn_started_at", "turn_token", "turn_error"]) {
    check(`055 が列 ${c} を追加する`, sql.includes(c));
  }
  check("055 が turn_status の CHECK を持つ", /CHECK \(turn_status IN/.test(sql));
}

// ── 2. 4つの chat ルートが非同期構造を持つ ───────────────
const API = join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]");
const routes = {
  asis_analyses: join(API, "asis-analysis", "[asisId]", "chat", "route.ts"),
  issue_dialogues: join(API, "issue-dialogue", "[dialogueId]", "chat", "route.ts"),
  measure_dialogues: join(API, "measure-dialogue", "[dialogueId]", "chat", "route.ts"),
  improvement_dialogues: join(API, "improvement-dialogue", "[dialogueId]", "chat", "route.ts"),
};
for (const [table, file] of Object.entries(routes)) {
  const label = file.replace(APP_ROOT + "/", "");
  check(`${label} が存在する`, existsSync(file));
  if (!existsSync(file)) continue;
  const src = read(file);
  check(`${label}: TURN_TABLE = "${table}"`, src.includes(`const TURN_TABLE = "${table}" as const`));
  for (const fn of ["beginTurn", "claimStep", "failTurn", "isStepRequest", "currentTurnToken", "turnDoneSql"]) {
    check(`${label}: ${fn} を使う`, new RegExp(`${fn}(<[^>]*>)?\\(`).test(src));
  }
  // サーバーが自分自身を fire-and-forget で呼ぶ方式は復活させない。
  // Lambda はレスポンスを返した時点で実行を凍結するため、その呼び出しは届かず、
  // Anthropic を一度も呼ばないままターンが固まっていた（2026-08-31、ログに一行も残らず判明）。
  // keepalive:true はブラウザの fetch 仕様であって Node（undici）では効かない。
  check(`${label}: サーバーからの自己呼び出しを使っていない`, !src.includes("triggerTurnStep"));
  check(`${label}: 画面からの step 要求を受け付ける`, /parsed\.data\.action === "step"/.test(src));
  check(`${label}: 202 で受理する`, /status: 202/.test(src));
  check(`${label}: runTurn を持つ`, /async function runTurn\(/.test(src));
  check(`${label}: 保存は turn_token 一致行のみ`, /AND turn_token = \$\d+/.test(src));
  check(`${label}: 再試行と step を受け付ける`, src.includes('z.enum(["retry", "step"])'));
  // runTurn の中で NextResponse を返してはいけない（例外で failTurn に流す）
  const runTurnBody = src.slice(src.indexOf("async function runTurn("));
  check(`${label}: runTurn 内に NextResponse.json が無い`, !runTurnBody.includes("NextResponse.json("));
  // 同期時代の名残（history に userMessage を足す）が復活していない
  check(`${label}: history に発言を二重追加しない`, !/const history = \[\.\.\.\w+\.messages, userMessage\]/.test(src));
}

// ── 3. GET ルートが turn 状態を返す ───────────────────
const gets = [
  join(API, "asis-analysis", "[asisId]", "route.ts"),
  join(API, "issue-dialogue", "[dialogueId]", "route.ts"),
  join(API, "measure-dialogue", "[dialogueId]", "route.ts"),
  join(API, "improvement-dialogue", "[dialogueId]", "route.ts"),
];
for (const file of gets) {
  const label = file.replace(APP_ROOT + "/", "");
  const src = existsSync(file) ? read(file) : "";
  check(`${label}: turnStateOf を返す`, src.includes("turnStateOf(row)"));
  check(`${label}: turn_started_at を読む`, src.includes("turn_started_at"));
}

// ── 4. 4画面がポーリング＋再試行を持つ ─────────────────
const clients = [
  join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "asis-analysis", "AsisAnalysisClient.tsx"),
  join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "issue-hypothesis", "IssueHypothesisClient.tsx"),
  join(APP_ROOT, "src", "components", "measure", "MeasureDialoguePanel.tsx"),
  join(APP_ROOT, "src", "components", "improvement", "ImprovementDialoguePanel.tsx"),
];
for (const file of clients) {
  const label = file.replace(APP_ROOT + "/", "");
  const src = existsSync(file) ? read(file) : "";
  check(`${label}: waitForTurn を使う`, src.includes("waitForTurn<"));
  check(`${label}: 202 受理を判定する`, src.includes("isAcceptedTurn("));
  check(`${label}: 再読み込み後に待ち受けを再開する`, src.includes("isTurnProcessing(selected)"));
  check(`${label}: 再試行ボタンがある`, src.includes('action: "retry"'));
  // 起動役は画面。202 を受理したどちらの経路（送信・再試行）でも step を叩くこと
  check(
    `${label}: 受理後に step を起動する（送信・再試行の2箇所）`,
    (src.match(/requestTurnStep\(/g) ?? []).length >= 2,
  );
}

// ── 4.15 失効までの猶予 ──────────────────────────
// 実測でAIターンは 41〜159秒かかる。失効が短すぎると、担当者がまだ走っている
// ターンを見限って再試行し、再試行が turn_token を差し替えるため、直後に返ってきた
// 結果が `WHERE turn_token = $token` に一致せず黙って捨てられる（2026-09-01、4回連続）。
{
  const async_ = read(join(APP_ROOT, "src", "lib", "ai", "asyncTurn.ts"));
  const m = async_.match(/TURN_STALE_MINUTES = (\d+)/);
  const stale = m ? Number(m[1]) : 0;
  check("asyncTurn: 失効までの猶予が実測（159秒）より十分長い", stale >= 6);
  const client = read(join(APP_ROOT, "src", "lib", "ai", "turnClient.ts"));
  const p = client.match(/TURN_POLL_TIMEOUT_MS = (\d+) \* 60_000/);
  const poll = p ? Number(p[1]) : 0;
  check("turnClient: ポーリングの上限が失効より長い", poll > stale);
  check("turnClient: 経過時間の整形がある", client.includes("export function formatElapsed"));
  const ind = read(join(APP_ROOT, "src", "components", "AiThinkingIndicator.tsx"));
  check("画面: 待っている間に経過時間を出す", ind.includes("formatElapsed(elapsedMs)"));
  check("画面: 長い工程だと伝える", ind.includes("そのままお待ちください"));
}

// ── 4.2 起動役の所在 ────────────────────────────
// サーバーの自己 fetch は Lambda 凍結で消えることがあり、AIを一度も呼ばないまま
// ターンが固まった（2026-08-31）。恒久対策はジョブ表＋ワーカーだが、
// それまでの間「起動役は画面」を崩さないよう固定する。
{
  const async_ = read(join(APP_ROOT, "src", "lib", "ai", "asyncTurn.ts"));
  check("asyncTurn: turn_token を取り出す口がある", async_.includes("export async function currentTurnToken"));
  check(
    "asyncTurn: 自己呼び出しは使えないようにしてある",
    /export function triggerTurnStep\(\): never/.test(async_),
  );
  check("asyncTurn: 自己呼び出しで fetch していない", !/fetch\(`\$\{base\}/.test(async_));
  const client = read(join(APP_ROOT, "src", "lib", "ai", "turnClient.ts"));
  check("turnClient: step を起動する口がある", client.includes("export function requestTurnStep"));
  check("turnClient: step の応答は待たない", /requestTurnStep[\s\S]{0,200}void fetch\(/.test(client));
}

// ── 4.5 出力上限と空の返答の扱い ─────────────────
// max_tokens で切られるとツール入力のJSONが途中で切れ、reply が欠けたまま返る。
// それを「（応答を取得できませんでした）」として保存すると、対話に空のターンが残り
// 担当者は再試行もできない（2026-08-30 に仮説フェーズで発生）。
const turnSrc = read(join(APP_ROOT, "src", "lib", "ai", "dialogueTurn.ts"));
check("dialogueTurn: max_tokens の打ち切りを検出する", turnSrc.includes('stop_reason === "max_tokens"'));
check("dialogueTurn: 予算を広げて引き直す", turnSrc.includes("retriedForLength"));
check("dialogueTurn: 引き直しても切れたら null を返す", /if \(toolUse && response\.stop_reason === "max_tokens"\) return null;/.test(turnSrc));
check("dialogueTurn: 既定の出力予算が 2500 より広い", /opts\.maxTokens \?\? (\d+)/.test(turnSrc) && Number(RegExp.$1) > 2500);

for (const [table, file] of Object.entries(routes)) {
  const label = file.replace(APP_ROOT + "/", "");
  const src = read(file);
  check(`${label}: 空の返答を保存せず失敗にする`, src.includes("AIの返答が空でした"));
  check(
    `${label}: 空の返答のプレースホルダを保存しない`,
    !src.includes("（応答を取得できませんでした）"),
  );
  void table;
}
check(
  "issue-dialogue: フェーズごとに出力予算を変える（仮説は長い）",
  read(routes.issue_dialogues).includes("MAX_TOKENS_BY_STEP"),
);

// ── 4.6 プロンプトキャッシュの設計 ───────────────
// システムプロンプトを1本にまとめて末尾に区切りを置くと、毎ターン変わる
// 「これまでの整理内容」のせいで読み出しが一度も当たらず、書き込みの割増だけを払う
// （2026-08-30 まで実際にその状態だった）。不変部と可変部を分けることを固定する。
check("dialogueTurn: 不変部と可変部を分けて受け取れる", turnSrc.includes("DialogueSystem"));
check("dialogueTurn: 不変部だけにキャッシュの区切りを置く", turnSrc.includes("buildSystemBlocks"));
check("dialogueTurn: 対話履歴にもキャッシュの区切りを置く", turnSrc.includes("withHistoryCache"));
// 保持時間は不変部と履歴で分ける。
//   不変部（システムプロンプト）… 対話の合間に数十分空いても効かせたいので 1時間（書き込み 2.0倍）
//   履歴（毎ターン伸びる）      … 次のターンまでの数分しか再利用されないので 5分（書き込み 1.25倍）
// 両方 1h にしていた間は、伸び続ける履歴を毎ターン 2.0倍で書き直しており、
// 読み出しの節約分を書き込みの割増が食っていた（2026-08-30 に計測で判明）。
check(
  "dialogueTurn: 不変部の保持時間は1時間（間隔が空いても効かせる）",
  /CACHE_STABLE[^\n]*ttl: "1h"/.test(turnSrc),
);
check(
  "dialogueTurn: 履歴の保持時間は5分（毎ターン伸びるので割増を抑える）",
  /CACHE_HISTORY[^\n]*ttl: "5m"/.test(turnSrc),
);
check(
  "dialogueTurn: 不変部に CACHE_STABLE を使っている",
  /buildSystemBlocks[\s\S]*?cache_control: CACHE_STABLE/.test(turnSrc),
);
check(
  "dialogueTurn: 履歴に CACHE_HISTORY を使っている",
  /withHistoryCache[\s\S]*?cache_control: CACHE_HISTORY/.test(turnSrc),
);
// 効果を後から確かめられること（ai_usage_logs にキャッシュの内訳が残る）
{
  const gw = read(join(APP_ROOT, "src", "lib", "ai", "gateway.ts"));
  check(
    "gateway: キャッシュの書き込み/読み出しトークンを記録する",
    gw.includes("cache_creation_input_tokens") && gw.includes("cache_read_input_tokens"),
  );
  const errScript = read(join(APP_ROOT, "scripts", "show-ai-errors.mjs"));
  check("ai:errors: キャッシュの内訳を表示する", errScript.includes("cache(read="));
}

for (const [name, file] of [
  ["現状整理", join(APP_ROOT, "src", "lib", "asis", "prompt.ts")],
  ["課題仮説設定", join(APP_ROOT, "src", "lib", "issue", "prompt.ts")],
]) {
  const src = read(file);
  check(`${name}: システムプロンプトを stable / volatile で返す`, /\{ stable, volatile \}/.test(src));
  check(`${name}: 可変部に現在のフェーズを置く`, /const volatile = `現在のフェーズ/.test(src));
  // 整理済みの内容（毎ターン変わる）が可変部の側に来ていること＝位置で判定する
  const volatileAt = src.indexOf("const volatile = `現在のフェーズ");
  const summaryAt = Math.max(src.indexOf("${dataSummary(data)}"), src.indexOf("${swotSummary(swot)}"));
  check(
    `${name}: 整理済みの内容を可変部に置いている`,
    volatileAt > 0 && summaryAt > volatileAt,
  );
}
// キャッシュの効き具合はログでしか確かめられない。
// input_tokens だけではキャッシュ読み出し・書き込みと区別できず、
// 「効いているつもり」を検証できない（2026-08-30 に実際に判断できなかった）。
const gatewaySrc = read(join(APP_ROOT, "src", "lib", "ai", "gateway.ts"));
check("gateway: キャッシュ書き込みトークンを記録する", gatewaySrc.includes("cache_creation_input_tokens"));
check("gateway: キャッシュ読み出しトークンを記録する", gatewaySrc.includes("cache_read_input_tokens"));
check(
  "056: ai_usage_logs にキャッシュのトークン列がある",
  read(join(REPO_ROOT, "infra", "migrations", "056_ai_cache_tokens.sql")).includes("cache_read_tokens"),
);

check(
  "現状整理: 共通ヘルパーを使う（写しを持たない）",
  read(join(API, "asis-analysis", "[asisId]", "chat", "route.ts")).includes("callDialogueTool("),
);

// ── 4.7 引用マークアップの除去 ───────────────────
// web_search 使用時にモデルが <cite …> を本文に混ぜてくることがあり、
// そのまま保存すると画面・課題仮説・計画書まで生のタグが残る（2026-08-30 に発生）。
check("dialogueTurn: 引用マークアップの除去関数がある", turnSrc.includes("stripCitationMarkup"));
for (const [table, file] of Object.entries(routes)) {
  const src = read(file);
  check(
    `${file.replace(APP_ROOT + "/", "")}: 取り込み時に引用マークアップを落とす`,
    src.includes("stripCitationMarkup("),
  );
  void table;
}

// ── 5. turnClient.ts の純粋ロジック ───────────────────
const work = mkdtempSync(join(tmpdir(), "asyncturn-"));
const outFile = join(work, "turnClient.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "ai", "turnClient.ts"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=neutral",
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);
  check("isAcceptedTurn: 202 + processing のみ真", m.isAcceptedTurn(202, { turn_status: "processing" }) === true);
  check("isAcceptedTurn: 200 は偽", m.isAcceptedTurn(200, { turn_status: "processing" }) === false);
  check("isAcceptedTurn: idle は偽", m.isAcceptedTurn(202, { turn_status: "idle" }) === false);
  check("isTurnProcessing: null 安全", m.isTurnProcessing(null) === false);
  check("isTurnProcessing: processing", m.isTurnProcessing({ turn_status: "processing" }) === true);
  check("ポーリングのタイムアウトはサーバーの失効（3分）より長い", m.TURN_POLL_TIMEOUT_MS > 3 * 60_000);

  // waitForTurn: fetch をモックして「processing → idle」で抜けることを確認
  const seq = [
    { data: { turn_status: "processing" } },
    { data: { turn_status: "idle", messages: ["ok"] } },
  ];
  let calls = 0;
  globalThis.fetch = async () => {
    const body = seq[Math.min(calls, seq.length - 1)];
    calls++;
    return { ok: true, json: async () => body };
  };
  const got = await m.waitForTurn("/x", { intervalMs: 1, timeoutMs: 1000 });
  check("waitForTurn: processing の間は待ち、idle で返る", got.turn_status === "idle" && calls === 2);

  // 通信失敗は無視して継続し、タイムアウトで例外
  globalThis.fetch = async () => {
    throw new Error("network");
  };
  let threw = false;
  try {
    await m.waitForTurn("/x", { intervalMs: 1, timeoutMs: 20 });
  } catch (e) {
    threw = e instanceof Error && e.message === m.TURN_TIMEOUT_ERROR;
  }
  check("waitForTurn: 通信失敗は無視し、期限で TURN_TIMEOUT_ERROR", threw);
} catch (e) {
  check(`turnClient.ts のバンドル/実行: ${e instanceof Error ? e.message : e}`, false);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// stripCitationMarkup の挙動（server-only のため実装と同じ正規表現で検証する）
{
  const strip = (t) =>
    t
      .replace(/<\/?cite\b[^>]*>/gi, "")
      .replace(/<\/?citation\b[^>]*>/gi, "")
      .replace(/\[\/?cite(?::[^\]]*)?\]/gi, "");
  check(
    "引用除去: タグを外して中身は残す",
    strip('<cite index="4-1">研修が重要である</cite>と指摘されている') ===
      "研修が重要であると指摘されている",
  );
  check("引用除去: 通常の文は変えない", strip("委託先が専門性を持てばよい") === "委託先が専門性を持てばよい");
  check("引用除去: 角括弧形式にも対応", strip("重要である[cite:12]") === "重要である");
  check(
    "引用除去: 山括弧を含む通常の記述は壊さない",
    strip("目標値 > 現状値 の場合") === "目標値 > 現状値 の場合",
  );
}

console.log(`\ncheck-async-turn: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
