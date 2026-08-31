#!/usr/bin/env node
/**
 * 課題仮説設定の整合性検査 — 問題IDのずれによる誤選定を防ぐ
 *
 * この検査を作った理由:
 *   2026-08-29、担当者の「p1とp5は同じなのでまとめて」という依頼に対し、AIが
 *   返答の文章の中でだけ番号を振り直した。new_problems が追加専用で統合手段が
 *   無かったため保存済みの問題は8件のまま残り、以降 AI が使う番号と保存済みIDの
 *   対応が崩れた。その状態で出された selection が別の問題に適用され、
 *   「EBPMノウハウの欠如」を選定したつもりで「地震後コミュニティの未回復」が
 *   課題として選定された。画面上は正常に見えるため気づきにくく、
 *   そのまま真因分析・仮説・施策へ流れる。
 *
 *   対策は3層: ①merge_problems でデータ上も統合する（行は消さず retired）
 *   ②selection に problem_text_echo を必須にしてサーバーで文言照合
 *   ③プロンプトで番号の振り直しを禁止
 *   この3層が外れていないことをここで固定する。
 *
 * 使い方:
 *   node scripts/check-issue-integrity.mjs
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// ── 1. ツール定義とプロンプトの規律 ─────────────────
const promptSrc = read(join(APP_ROOT, "src", "lib", "issue", "prompt.ts"));
check("prompt: merge_problems をツールに持つ", promptSrc.includes("merge_problems"));
check("prompt: problem_updates をツールに持つ", promptSrc.includes("problem_updates"));
check("prompt: problem_text_echo をツールに持つ", promptSrc.includes("problem_text_echo"));
check(
  "prompt: problem_text_echo が selection の必須項目",
  /required:\s*\[[^\]]*"problem_text_echo"/s.test(promptSrc),
);
check("prompt: 番号の振り直しを禁止している", promptSrc.includes("振り直さないでください"));
check(
  "prompt: 文章だけの統合を禁じている",
  promptSrc.includes("文章の中だけで統合したことにしてはいけません"),
);
// 出典の規律（もっともらしい固有名詞が検証されずに計画書へ流れるのを防ぐ）
check("prompt: references をツールに持つ", promptSrc.includes("references: {"));
check("prompt: 出典を必須と明示している", promptSrc.includes("必ず references に出典を入れて"));
check("prompt: 記憶による断定を禁じている", promptSrc.includes("記憶に頼って正式名称"));
// 重点指向と点数の整合
check("prompt: 選定はスコア上位からと明示", promptSrc.includes("選定は原則としてスコアの上位から"));
check("prompt: 選定差し替え時の点数付け直しを求める", promptSrc.includes("点数も対象の問題に合わせて付け直す"));
check("prompt: 矛盾をAIに提示する", promptSrc.includes("選定と点数が矛盾しています"));
check(
  "prompt: 退役した問題を一覧から外して提示する",
  promptSrc.includes("p.retired") && promptSrc.includes("退役"),
);

// ── 2. chat ルートの適用順とガード ────────────────
const routeSrc = read(
  join(
    APP_ROOT, "src", "app", "api", "admin", "projects", "[id]",
    "issue-dialogue", "[dialogueId]", "chat", "route.ts",
  ),
);
check("chat: applyProblemMerges を使う", routeSrc.includes("applyProblemMerges("));
check("chat: validateSelectionEchoes で照合する", routeSrc.includes("validateSelectionEchoes("));
check(
  "chat: 選別の対象を生存中の問題に限る",
  routeSrc.includes("activeProblems(problems).map"),
);
check(
  "chat: 不一致時に selection フェーズへ留める",
  /phase = "selection"/.test(routeSrc),
);
check(
  "chat: 不一致の選別を保存しない（フィルタしている）",
  routeSrc.includes("recheck.mismatched.some") || routeSrc.includes("echoCheck.mismatched.some"),
);
check(
  "chat: 退役を考慮した選定判定を使う",
  routeSrc.includes("selectedActiveProblemIds("),
);
check("chat: 出典を取り込む", routeSrc.includes("sanitizeReferences("));
check("chat: 出典なしの発言に印を付ける", routeSrc.includes("needsCitation(reply)"));

// ── 2.5 真因は「選定した課題ごとに」確定する ─────────────
// JIS Q 9024 の要因解析は選定した課題1件ずつに行うもの。
// 1件でも真因があれば先へ進める判定にしていたため、3件選定したのに
// 1件しか特性要因図・なぜなぜが残らないまま仮説へ進めてしまった（2026-08-30）。
// 大骨は現状整理の PESTLE/7S と連結しているので、欠けた課題はそこだけ
// 現状整理から真因までの筋道が辿れなくなる。
check(
  "chat: 未確定の真因を課題ごとに数える",
  routeSrc.includes("unresolvedRootCauseIds("),
);
check(
  "chat: 完了ガードが全件の真因を要求する",
  /hasResolvedRootCause[\s\S]{0,200}unresolvedRootCauseIds\([\s\S]{0,120}\.length === 0/.test(routeSrc),
);
check(
  "chat: 追いターンで未確定の課題IDを具体的に示す",
  routeSrc.includes("pending.join("),
);
check(
  "課題仮説設定: 選定した課題は1件残らず真因を出す旨を指示する",
  read(join(APP_ROOT, "src", "lib", "issue", "prompt.ts")).includes("1件残らず"),
);
check(
  "課題仮説設定: 未確定の真因を整理内容に警告として出す",
  read(join(APP_ROOT, "src", "lib", "issue", "prompt.ts")).includes("真因が未確定の課題"),
);

// ── 3. 書き出し（commit）が退役分を除く ───────────────
const commitSrc = read(
  join(
    APP_ROOT, "src", "app", "api", "admin", "projects", "[id]",
    "issue-dialogue", "[dialogueId]", "commit", "route.ts",
  ),
);
check("commit: 退役した問題の仮説を書き出さない", commitSrc.includes("activeProblems("));

// ── 4. 画面が統合を隠さない ──────────────────────
const clientSrc = read(
  join(
    APP_ROOT, "src", "app", "(admin)", "projects", "[id]",
    "issue-hypothesis", "IssueHypothesisClient.tsx",
  ),
);
check("画面: 統合済みバッジを出す", clientSrc.includes("に統合"));
check("画面: 件数から退役分を除く", clientSrc.includes("!p.retired"));
// 出所（引用原文）はトレーサビリティの証跡。完了を待たず対話中に確認できること
check("画面: 対話中でも出所を開ける", clientSrc.includes("出所を表示"));
check("画面: 出所トグルが ProblemList の compact を切り替える", clientSrc.includes("compact={!showSource}"));
// 引き継いだ複数の出所を1件ずつ引用する（別々のSWOT項目を1つの引用に見せない）
check("画面: 出所を1件ずつ引用する", clientSrc.includes("現状整理より: 「{t}」"));
// 出典と重点指向の可視化
check("画面: 出典を表示する", clientSrc.includes("MessageSources"));
check("画面: 出典なしの警告を出す", clientSrc.includes("出典が示されていません"));
check("画面: 選定と点数の矛盾を知らせる", clientSrc.includes("SelectionInconsistencyNotice"));
check("画面: 真因が未確定の課題を知らせる", clientSrc.includes("UnresolvedRootCauseNotice"));
// 真因分析の最中に残っているのは工程が進んでいる証拠であって異常ではない。
// 通常状態を赤い警告で出し続けると、本当の異常（仮説まで進んだのに欠けている）を見過ごす。
check("画面: 真因の通知に工程を渡している", clientSrc.includes("step={selected.current_step}"));
check(
  "画面: 真因分析より前の工程では出さない",
  /ISSUE_STEP_ORDER\.indexOf\(step\)[\s\S]{0,120}indexOf\("rootcause"\)[\s\S]{0,40}return null/.test(
    clientSrc,
  ),
);
check("画面: 真因分析中は進捗として出す（件数）", clientSrc.includes("真因 ${total - pending.length}"));
check(
  "画面: 仮説以降で残っていれば警告にする",
  clientSrc.includes('const inProgress = step === "rootcause"'),
);
// 件数の食い違い（IDの最大値を件数と取り違える）を防ぐ
check(
  "課題仮説設定: 件数は一覧の行数を数えるよう指示する",
  read(join(APP_ROOT, "src", "lib", "issue", "prompt.ts")).includes("IDの最大値は件数ではありません"),
);
// 優先順位は選別スコアで決まる。仮説だけを見て「なぜこれが1位なのか」を
// 追えるよう、順位と根拠の点数を並べて出す。
check("画面: 仮説に優先順位を出す", /優先度 \{?c\.priority_rank/.test(clientSrc));
check("画面: 優先順位の根拠（選別スコア）も添える", clientSrc.includes("選別 ${sel.score}点"));
check("画面: 仮説ビューに選別結果を渡している", clientSrc.includes("selection={record.selection}"));

// ── 5. 純粋ロジックの実挙動 ─────────────────────
const work = mkdtempSync(join(tmpdir(), "issue-integrity-"));
const outFile = join(work, "types.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", "lib", "issue", "types.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);

  const base = () => [
    { id: "p1", text: "指標体系の断絶で幸福感が分野別施策に落ちていない", origin: "dialogue" },
    { id: "p2", text: "主観的幸福感の現状値が測れていない", origin: "dialogue" },
    {
      id: "p5",
      text: "分野別計画の成果目標がアウトプット指標中心でアウトカム指標がない",
      origin: "weakness",
      source_text: "成果目標がアウトプット指標中心",
    },
  ];

  // 統合
  const merged = m.applyProblemMerges(base(), [
    { into: "p1", from: ["p5"], text: "指標体系の断絶＋アウトカム指標の欠如" },
  ]);
  const p1 = merged.find((p) => p.id === "p1");
  const p5 = merged.find((p) => p.id === "p5");
  check("統合: 統合先の文言が差し替わる", p1.text === "指標体系の断絶＋アウトカム指標の欠如");
  check("統合: 統合元は retired になる", p5.retired === true && p5.merged_into === "p1");
  check("統合: 行は消えない（IDが残る）", merged.length === 3);
  check(
    "統合: 引用原文が統合先へ引き継がれる（トレーサビリティ）",
    (p1.source_text ?? "").includes("成果目標がアウトプット指標中心"),
  );
  check("統合: activeProblems が退役を除く", m.activeProblems(merged).length === 2);

  // 異常系
  check("統合: 自己統合は無視", m.applyProblemMerges(base(), [{ into: "p1", from: ["p1"] }])
    .every((p) => !p.retired));
  check("統合: 存在しないIDは無視", m.applyProblemMerges(base(), [{ into: "p9", from: ["p1"] }])
    .every((p) => !p.retired));
  check("統合: 退役済みへの統合は無視",
    m.applyProblemMerges(merged, [{ into: "p5", from: ["p2"] }])
      .find((p) => p.id === "p2").retired !== true);

  // エコー照合 — これが今回の事故を検出する層
  const probs = base();
  const okRes = m.validateSelectionEchoes(probs, [
    { problem_id: "p1", problem_text_echo: "指標体系の断絶で幸福感が" },
  ]);
  check("照合: 正しいエコーは通る", okRes.ok.length === 1 && okRes.mismatched.length === 0);

  const wrongRes = m.validateSelectionEchoes(probs, [
    // 事故の再現: p2 のつもりで p5 の文言をエコーしている
    { problem_id: "p5", problem_text_echo: "主観的幸福感の現状値が測れていない" },
  ]);
  check("照合: IDと文言の取り違えを検出する", wrongRes.mismatched.length === 1);

  check(
    "照合: エコー未記入は不一致扱い（省略で素通りさせない）",
    m.validateSelectionEchoes(probs, [{ problem_id: "p1" }]).mismatched.length === 1,
  );
  check(
    "照合: 退役した問題への選別は不一致扱い",
    m.validateSelectionEchoes(merged, [
      { problem_id: "p5", problem_text_echo: "分野別計画の成果目標が" },
    ]).mismatched.length === 1,
  );
  check(
    "照合: 空白や記号のゆれは許容する",
    m.validateSelectionEchoes(probs, [
      { problem_id: "p2", problem_text_echo: " 主観的幸福感の、現状値が " },
    ]).ok.length === 1,
  );
  check(
    "照合: 短すぎるエコーは通さない",
    m.validateSelectionEchoes(probs, [{ problem_id: "p1", problem_text_echo: "指標" }])
      .mismatched.length === 1,
  );

  // 出典が要りそうな発言の判定
  check(
    "出典判定: 鉤括弧つきの資料名を挙げていれば真",
    m.needsCitation("内閣府「満足度・生活の質に関する調査」の設問を使えます") === true,
  );
  check(
    "出典判定: 固有名詞が無ければ偽（誤検知を避ける）",
    m.needsCitation("各課がアウトプット指標を追う構造になっています") === false,
  );
  check(
    "出典判定: 鉤括弧があっても資料を示す語が無ければ偽",
    m.needsCitation("担当者が「足がない」とおっしゃっていた点ですね") === false,
  );

  // 重点指向の破れ
  const probs2 = [
    { id: "p1", text: "a", origin: "dialogue" },
    { id: "p2", text: "b", origin: "dialogue" },
    { id: "p3", text: "c", origin: "dialogue" },
  ];
  const incons = m.findSelectionInconsistencies(probs2, [
    { problem_id: "p1", score: 43, selected: true },
    { problem_id: "p2", score: 23, selected: true },
    { problem_id: "p3", score: 39, selected: false },
  ]);
  check("重点指向: 選外のほうが高得点なら検出する", incons.length === 1);
  check(
    "重点指向: 検出内容が正しい",
    incons[0].selected_id === "p2" && incons[0].unselected_id === "p3",
  );
  check(
    "重点指向: 上位から選んでいれば検出しない",
    m.findSelectionInconsistencies(probs2, [
      { problem_id: "p1", score: 43, selected: true },
      { problem_id: "p3", score: 39, selected: true },
      { problem_id: "p2", score: 23, selected: false },
    ]).length === 0,
  );
  check(
    "重点指向: 退役した問題は判定に含めない",
    m.findSelectionInconsistencies(merged, [
      { problem_id: "p1", score: 20, selected: true },
      { problem_id: "p5", score: 90, selected: false },
    ]).length === 0,
  );

  // 退役を考慮した選定
  const selection = [
    { problem_id: "p1", selected: true },
    { problem_id: "p5", selected: true },
  ];
  check(
    "選定: 退役した問題は課題に数えない",
    m.selectedActiveProblemIds(merged, selection).join() === "p1",
  );

  // 真因の網羅（選定した課題ごとに1件ずつ）
  const sel3 = [
    { problem_id: "p1", selected: true },
    { problem_id: "p2", selected: true },
    { problem_id: "p3", selected: true },
  ];
  check(
    "真因: 1件だけ確定していても残りを未確定として返す",
    m.unresolvedRootCauseIds(probs2, sel3, [{ problem_id: "p1", root_cause: "指標体系の断絶" }])
      .join() === "p2,p3",
  );
  check(
    "真因: 全件確定していれば空になる",
    m.unresolvedRootCauseIds(
      probs2,
      sel3,
      sel3.map((s) => ({ problem_id: s.problem_id, root_cause: "x" })),
    ).length === 0,
  );
  check(
    "真因: 空文字の root_cause は確定と見なさない",
    m.unresolvedRootCauseIds(probs2, sel3, [
      { problem_id: "p1", root_cause: "  " },
      { problem_id: "p2", root_cause: "y" },
      { problem_id: "p3", root_cause: "z" },
    ]).join() === "p1",
  );
  check(
    "真因: 選定していない問題は要求しない",
    m.unresolvedRootCauseIds(
      probs2,
      [
        { problem_id: "p1", selected: true },
        { problem_id: "p2", selected: false },
      ],
      [{ problem_id: "p1", root_cause: "x" }],
    ).length === 0,
  );
  check(
    "真因: 退役した問題は要求しない",
    m.unresolvedRootCauseIds(merged, selection, [{ problem_id: "p1", root_cause: "x" }]).length === 0,
  );
} catch (e) {
  check(`types.ts のバンドル/実行: ${e instanceof Error ? e.message : e}`, false);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck-issue-integrity: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
