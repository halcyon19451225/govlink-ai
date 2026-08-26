#!/usr/bin/env node
/**
 * 計画書の調製（PL2 P③）の検証 — check:plandoc
 *
 * この検査を作った理由:
 *   計画書は「AIの下書き＋手動編集＋確定」を JSONB (sections) で往復させる。
 *   ここが壊れると **手動編集がAI再生成で消える**（locked保護の破れ）か、
 *   壊れた md が docx レンダラで落ちる。純関数と docx 生成を毎回検証する。
 *
 * 検査対象:
 *   1. 純関数（document.ts）… 章構成・サニタイズ・locked保護・md-lite
 *   2. docx生成（docx.ts） … 3形式すべて有効なZIP（PK）を返す
 *   3. 配線 … 049 / ルート / サイドバー / check連鎖の整合（テキスト検査）
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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

const work = mkdtempSync(join(tmpdir(), "plandoc-"));
try {
  // ── 1. 純関数（document.ts）─────────────────────────────
  const docFile = join(work, "document.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "plan", "document.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${docFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const d = await import(pathToFileURL(docFile).href);

  // 章構成: 7章固定・ID重複なし
  const ids = d.PLAN_CHAPTERS.map((c) => c.id);
  check("章構成: 定型7章", ids.length === 7);
  check("章構成: IDに重複がない", new Set(ids).size === ids.length);
  check("章構成: 設計P③の章が揃う",
    ["background", "current", "policy", "measures", "logic_model", "structure", "evaluation"]
      .every((x) => ids.includes(x)));
  check("variant語彙: full/simple/digest（049のCHECKと同一）",
    JSON.stringify(d.PLAN_DOC_VARIANTS.map((v) => v.key)) === '["full","simple","digest"]');

  // normalizeSections: 防御
  const norm = d.normalizeSections([
    { id: "background", heading: "背景", body_md: "本文", summary: "要約", source_refs: ["KPI一覧", 42], locked: "yes" },
    { id: "", heading: "IDなしは捨てる" },
    "文字列は捨てる",
    { id: "x", heading: "h", body_md: 7 },
  ]);
  check("normalize: 不正な章を落とす（有効2件）", norm.length === 2);
  check("normalize: source_refsは文字列のみ", norm[0].source_refs.length === 1 && norm[0].source_refs[0] === "KPI一覧");
  check("normalize: lockedは厳密true以外false", norm[0].locked === false);
  check("normalize: 非文字列body_mdは空へ", norm[1].body_md === "");
  check("normalize: 配列以外は空配列", d.normalizeSections("junk").length === 0);

  // mergeGeneratedSections: locked保護・欠落章の温存・定型順
  const existing = [
    { id: "current", heading: "現状と課題", body_md: "手動編集済み", summary: "手動要約", source_refs: [], locked: true },
    { id: "policy", heading: "基本方針・目標", body_md: "旧本文", summary: "旧要約", source_refs: [], locked: false },
  ];
  const generated = [
    { id: "current", body_md: "AIが上書きしようとした", summary: "AI要約" },
    { id: "background", body_md: "新規生成の背景", summary: "背景要約", source_refs: ["計画基本情報"] },
  ];
  const merged = d.mergeGeneratedSections(existing, generated);
  check("merge: 定型7章ぶん返す", merged.length === 7);
  check("merge: 章順は定型どおり", merged[0].id === "background" && merged[6].id === "evaluation");
  const mCur = merged.find((s) => s.id === "current");
  check("merge: locked=trueの章はAI出力で上書きしない", mCur.body_md === "手動編集済み" && mCur.summary === "手動要約" && mCur.locked === true);
  const mPol = merged.find((s) => s.id === "policy");
  check("merge: AIが返さなかった章は既存を温存", mPol.body_md === "旧本文");
  const mBg = merged.find((s) => s.id === "background");
  check("merge: 新規章を取り込む（source_refsも）", mBg.body_md === "新規生成の背景" && mBg.source_refs[0] === "計画基本情報");
  check("merge: 未登場章は空で用意（見出しは定型）", merged.find((s) => s.id === "evaluation").heading === "評価の方法");

  // sanitizeGeneratedSections: 防御
  const san = d.sanitizeGeneratedSections({
    sections: [
      { id: "policy", body_md: "本文", summary: "s", source_refs: ["a", 1] },
      { id: "zzz_unknown", body_md: "章IDが不正" },
      { id: "measures", body_md: "" },
      { id: "current" },
      null,
    ],
  });
  check("sanitize: 有効章のみ（不正ID・空本文を落とす）", san.length === 1 && san[0].id === "policy");
  check("sanitize: source_refsは文字列のみ", san[0].source_refs.length === 1);
  check("sanitize: 非オブジェクトは空", d.sanitizeGeneratedSections(null).length === 0 && d.sanitizeGeneratedSections({}).length === 0);

  // parseMdLite: 行政計画本文の最小記法
  const blocks = d.parseMdLite(
    "## 小見出し\n本文1行目\n本文2行目\n\n- 項目A\n・項目B\n1. 手順1\n2．手順2\n### 細見出し\n**強調**は素の文へ",
  );
  check("md-lite: ##/###見出し", blocks[0].kind === "heading" && blocks[0].level === 2 && blocks.some((b) => b.kind === "heading" && b.level === 3));
  check("md-lite: 連続行は1段落へ結合", blocks[1].kind === "paragraph" && blocks[1].text === "本文1行目本文2行目");
  const bullet = blocks.find((b) => b.kind === "bullet");
  check("md-lite: -/・の箇条書きを同一リストへ", bullet && bullet.items.length === 2 && bullet.items[1] === "項目B");
  const numbered = blocks.find((b) => b.kind === "numbered");
  check("md-lite: 1./2．の番号付き（全角ピリオドも）", numbered && numbered.items.length === 2);
  check("md-lite: **太字**は素の文字に落とす", blocks[blocks.length - 1].text === "強調は素の文へ");
  check("md-lite: 空文字は空配列", d.parseMdLite("").length === 0);

  // ── 1b. 評価報告書（PL3）の純関数 ───────────────────────
  const evalFile = join(work, "evalReport.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "plan", "evalReport.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${evalFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const ev = await import(pathToFileURL(evalFile).href);

  const evIds = ev.EVAL_CHAPTERS.map((c) => c.id);
  check("評価報告書: 定型6章", evIds.length === 6);
  check("評価報告書: 設計A①の章が揃う",
    ["overview", "kpi_status", "measure_results", "experiments", "improvements", "handover"]
      .every((x) => evIds.includes(x)));
  check("評価報告書: 計画書と章IDが衝突しない（章構成の取り違え検出用）",
    evIds.every((x) => !ids.includes(x)));
  check("docKind: eval→evaluation_report / それ以外→full（防御的既定）",
    ev.variantOfDocKind("eval") === "evaluation_report" &&
    ev.variantOfDocKind(ev.docKindOf("junk")) === "full" &&
    ev.docKindOf("eval") === "eval");
  check("docKind: 章構成の解決", ev.chaptersOfDocKind("eval").length === 6 && ev.chaptersOfDocKind("plan").length === 7);

  // merge/sanitize を評価6章の構成で（locked保護が章構成パラメタでも効く）
  const evExisting = [
    { id: "kpi_status", heading: "KPI達成状況", body_md: "手動編集済み", summary: "s", source_refs: [], locked: true },
  ];
  const evMerged = d.mergeGeneratedSections(
    evExisting,
    [{ id: "kpi_status", body_md: "AI上書き", summary: "x" }, { id: "overview", body_md: "概要", summary: "y" }],
    ev.EVAL_CHAPTERS,
  );
  check("評価merge: 6章ぶん・評価章順", evMerged.length === 6 && evMerged[0].id === "overview" && evMerged[5].id === "handover");
  check("評価merge: locked保護は章構成パラメタでも効く",
    evMerged.find((s) => s.id === "kpi_status").body_md === "手動編集済み");
  const evSan = d.sanitizeGeneratedSections(
    { sections: [{ id: "overview", body_md: "ok" }, { id: "policy", body_md: "計画書の章IDは評価では不正" }] },
    ev.EVAL_CHAPTERS,
  );
  check("評価sanitize: 評価6章のIDだけ受け付ける", evSan.length === 1 && evSan[0].id === "overview");

  // ── 1c. 説明資料（PL4）の純関数 ─────────────────────────
  const deckFile = join(work, "deck.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "plan", "deck.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${deckFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const dk = await import(pathToFileURL(deckFile).href);

  const ovIds = dk.OVERVIEW_SLIDES.map((c) => c.id);
  check("説明資料: 全体概要は6枚（表紙〜問い合わせ）",
    JSON.stringify(ovIds) === '["cover","why","vision","measures","schedule","contact"]');
  const uuid = "12345678-1234-1234-1234-123456789012";
  const uuid2 = "12345678-1234-1234-1234-123456789099";
  const mdefs = dk.measureSlideDefs([{ id: uuid, title: "受診勧奨" }, { id: uuid2, title: "通いの場" }]);
  check("説明資料: 取組別は表紙＋4枚/取組・IDにUUIDを含み60字以内",
    mdefs.length === 1 + 2 * 4 && mdefs[1].id === `m:${uuid}:benefit` && mdefs.every((d2) => d2.id.length <= 60));
  check("説明資料: deckTargetOf は不正値を overview に防御",
    dk.deckTargetOf("measures") === "measures" && dk.deckTargetOf("junk") === "overview");

  // 動的スライド構成でも merge の locked 保護が効く
  const dkMerged = d.mergeGeneratedSections(
    [{ id: "why", heading: "なぜこの計画か", body_md: "- 手動編集", summary: "手動原稿", source_refs: [], locked: true }],
    [{ id: "why", body_md: "- AI上書き", summary: "AI原稿" }, { id: "cover", body_md: "- 表紙", summary: "こんにちは。" }],
    dk.OVERVIEW_SLIDES,
  );
  check("説明資料merge: 6枚・lockedスライドの本文と読み原稿を守る",
    dkMerged.length === 6 &&
    dkMerged.find((s) => s.id === "why").summary === "手動原稿" &&
    dkMerged.find((s) => s.id === "cover").summary === "こんにちは。");

  // PlanSection → スライド変換（「- 」「・」箇条書き・見出し/素の行も1項目に）
  const slides = dk.sectionsToSlides([
    { id: "why", heading: "なぜこの計画か", body_md: "- 項目A\n・項目B\n## 見出しも項目に\n素の行も項目に\n", summary: "読み原稿です。", source_refs: [], locked: false },
  ]);
  check("説明資料: 本文→箇条書き変換（-/・/見出し/素の行）と読み原稿の対応",
    slides[0].bullets.length === 4 && slides[0].bullets[0] === "項目A" && slides[0].bullets[1] === "項目B" && slides[0].note === "読み原稿です。");

  // ── 2. docx生成（3形式ともZIPを返す）────────────────────
  const stub = join(work, "server-only-stub.mjs");
  writeFileSync(stub, "export default {};\n");
  const docxFile = join(work, "docx.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "plan", "docx.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=node",
     `--alias:server-only=${stub}`, `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${docxFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const dx = await import(pathToFileURL(docxFile).href);
  const input = {
    meta: { title: "検証計画", municipalityName: "検証市", planStart: "2026-04-01", planEnd: "2031-03-31", generatedOn: "2026-08-26" },
    sections: d.mergeGeneratedSections([], [
      { id: "background", body_md: "## 経緯\n上位計画に基づく。\n- 関連計画A", summary: "背景の要約。" },
      { id: "policy", body_md: "基本方針の本文。", summary: "方針の要約。", source_refs: ["KPI一覧"] },
    ]),
    layout: {},
    kpis: [{ label: "健診受診率", tier: "outcome_initial", unit: "%", baseline: 48.2, target: 55, deadline: "2027-03-31" }],
    measures: [{ title: "受診勧奨strengthen", target_population: "40-74歳", owner_department: "健康推進課", period: "2026-04-01〜2027-03-31", total_budget: 1200000 }],
    checkpoints: [{ name: "中間レビュー", phase: "C", scheduled_date: "2026-10-01" }],
  };
  for (const variant of ["full", "simple", "digest"]) {
    const buf = await dx.buildPlanDocx(variant, input);
    check(`docx: ${variant} が有効なZIP（PK）`, Buffer.isBuffer(buf) && buf.length > 3000 && buf[0] === 0x50 && buf[1] === 0x4b);
  }
  // 空データでも落ちない（未設定プレースホルダで生成できる）
  const emptyBuf = await dx.buildPlanDocx("full", {
    meta: { title: "空", municipalityName: "市", planStart: null, planEnd: null, generatedOn: "2026-08-26" },
    sections: [], layout: {}, kpis: [], measures: [], checkpoints: [],
  });
  check("docx: 空データでも生成できる", Buffer.isBuffer(emptyBuf) && emptyBuf[0] === 0x50);

  // 評価報告書のdocx（PL3 — 達成状況・評価・改善の表つき / 空データ）
  const evalBuf = await dx.buildEvalReportDocx({
    meta: { title: "検証 評価結果報告書", municipalityName: "検証市", planStart: "2026-04-01", planEnd: "2031-03-31", generatedOn: "2026-08-26" },
    sections: d.mergeGeneratedSections([], [
      { id: "overview", body_md: "## 評価の方法\n三層アウトカムで評価する。", summary: "概要。" },
      { id: "kpi_status", body_md: "到達度の読み方を説明する。", summary: "達成状況。", source_refs: ["KPI一覧"] },
    ], ev.EVAL_CHAPTERS),
    layout: {},
    kpis: [{ label: "健診受診率", tier: "outcome_initial", unit: "%", baseline: 48.2, current: 51.0, target: 55, rate: 41.2, achieved: false }],
    evaluations: [{ measure: "受診勧奨", tier: "outcome_initial", fiscal_year: 2026, result: "予定どおり実施・目標未達" }],
    improvements: [{ title: "勧奨文面の見直し", root_cause: "行動障壁", status: "in_progress", due_date: "2026-12-01" }],
  });
  check("docx: 評価報告書が有効なZIP（PK）", Buffer.isBuffer(evalBuf) && evalBuf.length > 3000 && evalBuf[0] === 0x50 && evalBuf[1] === 0x4b);
  const evalEmpty = await dx.buildEvalReportDocx({
    meta: { title: "空", municipalityName: "市", planStart: null, planEnd: null, generatedOn: "2026-08-26" },
    sections: [], layout: {}, kpis: [], evaluations: [], improvements: [],
  });
  check("docx: 評価報告書は空データでも生成できる", Buffer.isBuffer(evalEmpty) && evalEmpty[0] === 0x50);

  // ── 2b. pptx生成（PL4 — ノート欄=読み原稿つきでZIPを返す）──
  const pptxFile = join(work, "pptx.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "plan", "pptx.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=node",
     `--alias:server-only=${stub}`, `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${pptxFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const px = await import(pathToFileURL(pptxFile).href);
  const deckBuf = await px.buildAudienceDeck(
    { title: "検証計画のご案内", municipalityName: "検証市", generatedOn: "2026-08-26" },
    [
      { id: "cover", title: "表紙", bullets: ["市民のみなさまへ"], note: "こんにちは。ご説明します。" },
      { id: "why", title: "なぜこの計画か", bullets: ["健診を受ける人が減っています"], note: "理由からお話しします。" },
    ],
    {},
  );
  check("pptx: 説明資料が有効なZIP（PK）", Buffer.isBuffer(deckBuf) && deckBuf.length > 3000 && deckBuf[0] === 0x50 && deckBuf[1] === 0x4b);
  const deckEmpty = await px.buildAudienceDeck(
    { title: "空", municipalityName: "市", generatedOn: "2026-08-26" }, [], {},
  );
  check("pptx: 空データでも生成できる（表紙のみ）", Buffer.isBuffer(deckEmpty) && deckEmpty[0] === 0x50);

  // ── 3. 配線（テキスト検査）──────────────────────────────
  const migDirA = join(APP_ROOT, "_migrations");
  const migDirB = join(REPO_ROOT, "infra", "migrations");
  const migPath = existsSync(join(migDirA, "049_plan_documents.sql"))
    ? join(migDirA, "049_plan_documents.sql")
    : join(migDirB, "049_plan_documents.sql");
  const mig = readFileSync(migPath, "utf8");
  check("049: plan_documents と exports・variantのCHECK・一意制約",
    mig.includes("CREATE TABLE IF NOT EXISTS plan_documents") &&
    mig.includes("CREATE TABLE IF NOT EXISTS plan_document_exports") &&
    mig.includes("'full', 'simple', 'digest'") &&
    mig.includes("uq_plan_documents_project_variant"));
  check("049: generation.plan_doc の種付け", mig.includes("generation.plan_doc"));

  const apiDir = join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "plan-document");
  const genSrc = readFileSync(join(apiDir, "generate", "route.ts"), "utf8");
  check("生成ルート: ゲートウェイ経由・locked保護マージ・冪等upsert",
    genSrc.includes("aiCreateMessage") && genSrc.includes("mergeGeneratedSections") &&
    genSrc.includes("ON CONFLICT (project_id, variant)"));
  check("生成ルート: 確定済みへは生成しない", genSrc.includes('"finalized"') && genSrc.includes("409"));
  const rwSrc = readFileSync(join(apiDir, "rewrite", "route.ts"), "utf8");
  check("リライト: locked/finalized を拒否", rwSrc.includes("locked") && rwSrc.includes("finalized"));
  const exSrc = readFileSync(join(apiDir, "export", "route.ts"), "utf8");
  check("出力: S3 plan-documents へ保存し履歴を残す",
    exSrc.includes('"plan-documents"') && exSrc.includes("plan_document_exports"));
  check("出力: 表は実データから自動挿入（normalizeIndicatorTypeで層を正規化）",
    exSrc.includes("normalizeIndicatorType"));

  // ── 3b. PL3の配線 ───────────────────────────────────────
  const mig050Path = existsSync(join(migDirA, "050_eval_report.sql"))
    ? join(migDirA, "050_eval_report.sql")
    : join(migDirB, "050_eval_report.sql");
  const mig050 = readFileSync(mig050Path, "utf8");
  check("050: variantのCHECKをsupersetで張り替え（049の値を全部残す）",
    ["'full'", "'simple'", "'digest'", "'evaluation_report'"].every((v) => mig050.includes(v)) &&
    mig050.includes("DROP CONSTRAINT IF EXISTS plan_documents_variant_check") &&
    mig050.includes("plan_document_exports_variant_check"));
  check("050: generation.eval_report の種付け", mig050.includes("generation.eval_report"));

  check("生成ルート: 評価はgeneration.eval_report・章構成で分岐",
    genSrc.includes("generation.eval_report") && genSrc.includes("chaptersOfDocKind") &&
    genSrc.includes("gatherEvalTables"));
  check("出力ルート: evaluation_report を受け付け評価レンダラへ",
    exSrc.includes("evaluation_report") && exSrc.includes("buildEvalReportDocx"));
  check("リライト: doc パラメタで評価報告書にも対応", rwSrc.includes('"eval"') && rwSrc.includes("generation.eval_report"));
  const mainSrc = readFileSync(join(apiDir, "route.ts"), "utf8");
  check("CRUDルート: doc パラメタと評価の実データ表", mainSrc.includes("docKindOf") && mainSrc.includes("gatherEvalTables"));

  const selfEval = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "self-evaluation", "SelfEvaluationClient.tsx"), "utf8");
  const planClient = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "plan-document", "PlanDocumentClient.tsx"), "utf8");
  check("印刷CSS: 自己評価シートと評価報告書が共通CSSを使う（window.print方式）",
    selfEval.includes("PRINT_BASE_CSS") && planClient.includes("PRINT_BASE_CSS") && planClient.includes("window.print"));
  const tabs = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "plan-document", "DocumentTabs.tsx"), "utf8");
  check("画面: 評価報告書タブが同居（新メニューを立てない — 設計A①）",
    tabs.includes("評価報告書") && tabs.includes('"eval"'));

  // ── 3c. PL4の配線 ───────────────────────────────────────
  const mig051Path = existsSync(join(migDirA, "051_audience_deck.sql"))
    ? join(migDirA, "051_audience_deck.sql")
    : join(migDirB, "051_audience_deck.sql");
  const mig051 = readFileSync(mig051Path, "utf8");
  check("051: variantのCHECKをsupersetで張り替え（deck追加・050までの値を全部残す）",
    ["'full'", "'simple'", "'digest'", "'evaluation_report'", "'deck'"].every((v) => mig051.includes(v)));
  check("051: generation.audience_deck の種付け", mig051.includes("generation.audience_deck"));
  check("生成ルート: deckは対象選択（overview/measures）でスライド構成を動的に組む",
    genSrc.includes("measureSlideDefs") && genSrc.includes("OVERVIEW_SLIDES") && genSrc.includes("taskTypeOfDocKind"));
  check("出力ルート: deck → pptx（buildAudienceDeck・PPTX MIME）",
    exSrc.includes("buildAudienceDeck") && exSrc.includes("presentationml"));
  const evalReportSrc = readFileSync(join(APP_ROOT, "src", "lib", "plan", "evalReport.ts"), "utf8");
  check("taskTypeの対応: plan/eval/deck の3種がゲートウェイ語彙で解決",
    evalReportSrc.includes("generation.audience_deck") && evalReportSrc.includes("generation.eval_report"));
  const deckClient = readFileSync(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "plan-document", "DeckClient.tsx"), "utf8");
  check("画面: 説明資料タブ（対象選択・読み原稿編集・pptxダウンロード）",
    tabs.includes("説明資料") && deckClient.includes("読み原稿") && deckClient.includes('"deck"'));
  const pkgDeps = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
  check("package.json: pptxgenjs 依存", Boolean(pkgDeps.dependencies?.pptxgenjs));

  const sidebar = readFileSync(join(APP_ROOT, "src", "components", "ProjectSidebar.tsx"), "utf8");
  check("サイドバー: 計画書の調製（P区分・plan-document）",
    sidebar.includes('"plan-document"') && sidebar.includes("計画書の調製"));

  const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8"));
  check("package.json: docx依存とcheck:plandoc連鎖",
    Boolean(pkg.dependencies?.docx) && String(pkg.scripts?.check ?? "").includes("check:plandoc"));

  console.log(`check-plandoc: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
