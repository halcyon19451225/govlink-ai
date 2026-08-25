#!/usr/bin/env node
/**
 * 自律コーパス収集（X7a）の検査 — check:harvest
 *
 * この検査を作った理由:
 *   自動収集は「コーパス汚染」への最短経路になり得る。ここで固定するのは
 *   ①無確認の自動登録をしない（pending 投入・ON CONFLICT DO NOTHING・
 *     重複は付けるだけで自動では落とさない）
 *   ②語彙の同一性（outcome_tier＝三層アウトカム / PESTLE・7S＝As-Is定義 /
 *     マイグレーションのCHECKとアプリ語彙の一致）
 *   ③機械防御（sanitize）の挙動 — 出典なし・統計値の不正・海外ソースの
 *     外的妥当性メモ欠落を確実に弾く
 *   ④cron認証・ライセンス有効化ガードの存在
 *
 * 使い方:
 *   node scripts/check-harvest.mjs
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
const MIGRATION_CANDIDATES = [
  join(REPO_ROOT, "infra", "migrations"),
  join(APP_ROOT, "_migrations"),
];
const MIG_DIR = MIGRATION_CANDIDATES.find((p) => existsSync(p)) ?? MIGRATION_CANDIDATES[0];

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function bundle(work, srcRel, outName) {
  const outFile = join(work, outName);
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, ...srcRel),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  return pathToFileURL(outFile).href;
}

const work = mkdtempSync(join(tmpdir(), "harvest-"));
try {
  const types = await import(bundle(work, ["src", "lib", "corpus", "harvest", "types.ts"], "types.mjs"));
  const adapters = await import(bundle(work, ["src", "lib", "corpus", "harvest", "adapters.ts"], "adapters.mjs"));
  const tiers = await import(bundle(work, ["src", "lib", "outcome", "tiers.ts"], "tiers.mjs"));
  const asis = await import(bundle(work, ["src", "lib", "asis", "types.ts"], "asis.mjs"));

  // ── 1. 語彙の同一性 ──────────────────────────────────
  const tierKeys = tiers.OUTCOME_TIER_ORDER ?? Object.keys(tiers.OUTCOME_TIER_META ?? {});
  check(
    "outcome_tier は三層アウトカム（lib/outcome/tiers.ts）と同語彙",
    JSON.stringify([...types.HARVEST_OUTCOME_TIERS].sort()) === JSON.stringify([...tierKeys].sort()) &&
      types.HARVEST_OUTCOME_TIERS.length === 3,
  );
  check(
    "corpus_context の PESTLE タグは As-Is（PESTLE_ORDER）と同語彙",
    JSON.stringify(types.CONTEXT_PESTLE_TAGS) === JSON.stringify(asis.PESTLE_ORDER),
  );
  check(
    "corpus_context の 7S タグは As-Is（SEVEN_S_ORDER）と同語彙",
    JSON.stringify(types.CONTEXT_SEVEN_S_TAGS) === JSON.stringify(asis.SEVEN_S_ORDER),
  );

  // マイグレーション042のCHECKとアプリ語彙の一致
  const mig042Path = join(MIG_DIR, "042_corpus_harvest.sql");
  check("042_corpus_harvest.sql が存在する", existsSync(mig042Path));
  const mig = existsSync(mig042Path) ? readFileSync(mig042Path, "utf-8") : "";

  const inSql = (vals) => vals.every((v) => mig.includes(`'${v}'`));
  check("042: outcome_tier のCHECKに三層すべてある", inSql(types.HARVEST_OUTCOME_TIERS));
  check("042: effect_size_type のCHECKと一致", inSql(types.EFFECT_SIZE_TYPES.map((t) => t.key)));
  check("042: fiscal_effect_unit のCHECKと一致", inSql(types.FISCAL_EFFECT_UNITS.map((u) => u.key)));
  check("042: corpus_context.kind のCHECKと一致", inSql(types.CONTEXT_KINDS.map((k) => k.key)));
  check("042: swot_hint のCHECKと一致", inSql(types.SWOT_HINTS));
  check("042: region_scope のCHECKと一致", inSql(types.REGION_SCOPES));
  check("042: crawl_frequency のCHECKと一致", inSql(types.CRAWL_FREQUENCIES.map((f) => f.key)));
  check("042: 収集runのstatus語彙と一致", inSql(types.HARVEST_RUN_STATUS.map((s) => s.key)));
  check("042: ソース種別（kind）の語彙と一致", inSql(types.HARVEST_SOURCE_KINDS.map((k) => k.key)));
  check("042: pg_trgm 拡張とGINインデックスがある", mig.includes("pg_trgm") && mig.includes("gin_trgm_ops"));
  check("042: knowledge.harvest の種付けがある", mig.includes("'knowledge.harvest'"));
  check(
    "042: 初期ソースはすべて enabled=false（無許諾で動き出さない）",
    !/,\s*true\s*\)/.test(mig.slice(mig.indexOf("INSERT INTO corpus_sources"))),
  );

  // シード済みアダプタが実装レジストリに存在する
  for (const key of ["env_best", "nudge_share"]) {
    check(`042のシードアダプタが実装済み: ${key}`, mig.includes(`'${key}'`) && key in adapters.HARVEST_ADAPTERS);
  }

  // ── 2. source_key 規約と巡回スケジュール ─────────────
  check(
    "source_key: webseed:auto:<adapter>:<id> 形式",
    types.makeAutoSourceKey("env_best", "abc-123") === "webseed:auto:env_best:abc-123",
  );
  check(
    "source_key: 空白は畳む・長すぎるIDは切る",
    types.makeAutoSourceKey("a", "x y").includes("x-y") &&
      types.makeAutoSourceKey("a", "z".repeat(300)).length <= "webseed:auto:a:".length + 120,
  );
  check(
    "stableIdFromUrl: パス末尾から安定IDを作る",
    types.stableIdFromUrl("https://www.env.go.jp/content/900447977.pdf") === "content-900447977.pdf",
  );

  const now = new Date("2026-08-25T00:00:00Z");
  check("nextCrawlDue: manual は null", types.nextCrawlDue("manual", now, now) === null);
  check("nextCrawlDue: 未収集は即時対象", types.isCrawlDue("weekly", null, now) === true);
  const last = new Date("2026-08-20T00:00:00Z");
  check("nextCrawlDue: weekly は7日後", types.nextCrawlDue("weekly", last, now).getTime() === last.getTime() + 7 * 86400_000);
  check("isCrawlDue: 期限前は false", types.isCrawlDue("weekly", last, now) === false);
  check("isCrawlDue: monthly 30日経過で true", types.isCrawlDue("monthly", new Date("2026-07-20T00:00:00Z"), now) === true);

  // ── 3. sanitize（機械防御） ──────────────────────────
  const s = types.sanitizeHarvestEvidence;
  const base = {
    title: "テスト検証",
    source: "テスト機関 (2026)",
    effect_summary: "参加率 +7.2pt",
  };

  let r = s({ evidence: [base] });
  check("sanitize: 必須欄が揃えば通る", r.rows.length === 1 && r.rejected.length === 0);
  check("sanitize: design不明は case / Lv1", r.rows[0].design === "case" && r.rows[0].evidence_level === 1);

  r = s({ evidence: [{ ...base, source: "" }] });
  check("sanitize: 出典なしは捨て、理由を記録", r.rows.length === 0 && r.rejected[0]?.reason.includes("出典"));

  r = s({ evidence: [{ ...base, effect_summary: "" }] });
  check("sanitize: 効果要約なしは捨てる", r.rows.length === 0 && r.rejected.length === 1);

  r = s({ evidence: [{ ...base, design: "rct" }] });
  check("sanitize: rct の既定レベルは4", r.rows[0].evidence_level === 4);

  r = s({ evidence: [{ ...base, p_value: 1.5, ci_low: 0.9, ci_high: 0.5, effect_size_value: 0.72 }] });
  check(
    "sanitize: p値>1 と 逆転CI は null（点推定は残す）",
    r.rows[0].p_value === null && r.rows[0].ci_low === null && r.rows[0].ci_high === null && r.rows[0].effect_size_value === 0.72,
  );

  r = s({ evidence: [{ ...base, outcome_tier: "short_term" }] });
  check("sanitize: 語彙外の outcome_tier は null", r.rows[0].outcome_tier === null);

  r = s({ evidence: [{ ...base, effect_size_type: "beta" }] });
  check("sanitize: 語彙外の effect_size_type は null", r.rows[0].effect_size_type === null);

  r = s({ evidence: [base] }, { overseas: true });
  check("sanitize: 海外ソースは外的妥当性メモ必須（無ければ捨てる）", r.rows.length === 0 && r.rejected[0]?.reason.includes("外的妥当性"));

  r = s(
    { evidence: [{ ...base, transferability: "米国の郡単位の実証。日本の市区町村へは規模感が近い", fiscal_effect_amount: 100000 }] },
    { overseas: true },
  );
  check("sanitize: 海外行の財政効果額には参考値注記が付く", r.rows.length === 1 && r.rows[0].fiscal_note?.includes("海外・参考値"));

  r = s({ evidence: Array.from({ length: 30 }, () => ({ ...base })) });
  check("sanitize: 件数上限（20件）", r.rows.length + r.rejected.length <= 20);

  check("sanitize: 不正入力は空で返す", s(null).rows.length === 0 && s("x").rows.length === 0);

  // ── 4. アダプタ（一覧抽出の純ロジック） ──────────────
  const { htmlToText, extractAnchors, absolutizeUrl, HARVEST_ADAPTERS } = adapters;
  check("htmlToText: タグ・scriptを落とす", htmlToText("<script>x()</script><p>ナッジ &amp; EBPM</p>") === "ナッジ & EBPM");
  check(
    "extractAnchors: href とテキストを拾う",
    JSON.stringify(extractAnchors('<a href="/a.pdf">資料A</a>')) === JSON.stringify([{ href: "/a.pdf", text: "資料A" }]),
  );
  check("absolutizeUrl: 相対→絶対", absolutizeUrl("/content/x.pdf", "https://www.env.go.jp/page.html") === "https://www.env.go.jp/content/x.pdf");

  const bestHtml = `
    <a href="/content/900447977.pdf">八王子市 大腸がん検診 受診勧奨ナッジの検証結果について</a>
    <a href="https://www.env.go.jp/content/000123456.pdf">家庭部門の省エネ実証（ナッジ）報告書</a>
    <a href="https://other-site.example.com/evil.pdf">外部サイトの資料へのリンクテキスト</a>
    <a href="/index.html">ホーム</a>
    <a href="/earth/ondanka/nudge_case.html">こちら</a>`;
  const bestItems = HARVEST_ADAPTERS.env_best.listItems(bestHtml, "https://www.env.go.jp/earth/ondanka/nudge.html");
  check("env_best: 同一ホストのPDF・事例リンクだけ拾う", bestItems.length === 2);
  check("env_best: 外部ホストは拾わない", bestItems.every((i) => i.url.includes("env.go.jp")));
  check("env_best: ナビ文言（ホーム・こちら等）は拾わない", bestItems.every((i) => i.title !== "ホーム" && i.title !== "こちら"));
  check("env_best: stableId がURL由来で安定", bestItems[0].stableId === "content-900447977.pdf");

  const shareHtml = `
    <a href="/works/case-0123">〇〇市 特定健診の受診率向上ナッジ（リマインダー最適化）</a>
    <a href="/about">サイトについての説明ページ</a>
    <a href="/">トップ</a>`;
  const shareItems = HARVEST_ADAPTERS.nudge_share.listItems(shareHtml, "https://www.nudge-share.jp/");
  check("nudge_share: 事例詳細（深いパス）だけ拾う", shareItems.length === 1 && shareItems[0].url.includes("/works/case-0123"));

  for (const [key, a] of Object.entries(HARVEST_ADAPTERS)) {
    check(`アダプタ ${key}: run上限が設定されている（タイムアウト対策）`, Number.isFinite(a.itemLimitPerRun) && a.itemLimitPerRun > 0 && a.itemLimitPerRun <= 10);
    check(`アダプタ ${key}: 出典機関名がある`, typeof a.sourceOrg === "string" && a.sourceOrg.length > 0);
  }

  // ── 5. エンジン・ルートの静的検査（危険な逸脱の検出） ──
  const engineSrc = readFileSync(join(APP_ROOT, "src", "lib", "corpus", "harvest", "engine.ts"), "utf-8");
  check("engine: 投入は status='pending' のみ（自動承認しない）", engineSrc.includes("'pending'") && !/VALUES\s*\(\s*'approved'/.test(engineSrc));
  check("engine: ON CONFLICT DO NOTHING（検収済み行を上書きしない）", engineSrc.includes("ON CONFLICT (source_key) DO NOTHING"));
  check("engine: 重複は付けるだけ（DELETEしない）", !/DELETE\s+FROM\s+corpus_evidence/i.test(engineSrc));
  check("engine: 重複閾値 0.6", engineSrc.includes("DUP_THRESHOLD = 0.6"));
  check("engine: ゲートウェイ経由（knowledge.harvest）", engineSrc.includes('taskType: "knowledge.harvest"') && engineSrc.includes("aiCreateMessage"));
  check("engine: 無効ソースを実行時に拒否", engineSrc.includes("このソースは無効です"));

  const cronPath = join(APP_ROOT, "src", "app", "api", "cron", "corpus-harvest", "route.ts");
  check("cron ルートが存在する", existsSync(cronPath));
  const cronSrc = existsSync(cronPath) ? readFileSync(cronPath, "utf-8") : "";
  check("cron: x-cron-key / CORPUS_CRON_KEY による認証", cronSrc.includes("x-cron-key") && cronSrc.includes("CORPUS_CRON_KEY"));
  check("cron: 鍵不一致は401", cronSrc.includes("401"));
  check("cron: 1呼び出し1ソース（pickDueSource）", cronSrc.includes("pickDueSource"));

  const sourcesSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "ordo-admin", "corpus", "sources", "route.ts"), "utf-8");
  const sourcePatchSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "ordo-admin", "corpus", "sources", "[sourceId]", "route.ts"), "utf-8");
  check("sources API: license_note 空の有効化を拒否（POST）", sourcesSrc.includes("有効化できません"));
  check("sources API: license_note 空の有効化を拒否（PATCH）", sourcePatchSrc.includes("有効化できません"));
  check("sources API: 未実装アダプタを拒否", sourcesSrc.includes("未実装のアダプタ"));

  // ── 6. X7c: 検収スループット（043・一括検収・閲覧専用） ──
  const mig043Path = join(MIG_DIR, "043_corpus_review.sql");
  check("043_corpus_review.sql が存在する", existsSync(mig043Path));
  const mig043 = existsSync(mig043Path) ? readFileSync(mig043Path, "utf-8") : "";
  check("043: review_mode のCHECKとアプリ語彙（REVIEW_MODES）が一致", types.REVIEW_MODES.every((m) => mig043.includes(`'${m.key}'`)) && types.REVIEW_MODES.length === 3);
  check("043: reviewed_by を evidence/measures に追加", (mig043.match(/ADD COLUMN IF NOT EXISTS reviewed_by/g) ?? []).length === 2);
  check("REVIEW_MODES: 既定は full（migの DEFAULT と一致）", types.REVIEW_MODES[0].key === "full" && mig043.includes("DEFAULT 'full'"));
  check("SPOT_SAMPLE_RATE は 10%", types.SPOT_SAMPLE_RATE === 0.1);

  const bulkSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "ordo-admin", "corpus", "bulk", "route.ts"), "utf-8");
  check("bulk: 1トランザクション（transaction( を使用）", bulkSrc.includes("transaction(async"));
  check("bulk: pending 以外を絶対に触らない（SELECT と UPDATE 両方でガード）", (bulkSrc.match(/status = 'pending'/g) ?? []).length >= 3);
  check("bulk: reviewed_by / reviewed_at を1件ずつ記録", bulkSrc.includes("reviewed_by") && bulkSrc.includes("reviewed_at = now()"));
  check("bulk: 対象行をロック（FOR UPDATE）", bulkSrc.includes("FOR UPDATE"));
  check("bulk: ids か harvest_run_id の排他指定", bulkSrc.includes("どちらか一方"));
  check("bulk: 3種（measures/evidence/context）対応", ["corpus_measures", "corpus_evidence", "corpus_context"].every((t) => bulkSrc.includes(t)));

  const browseSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "ordo-admin", "corpus", "browse", "route.ts"), "utf-8");
  check("browse: approved のみ対象", browseSrc.includes("t.status = 'approved'"));
  check("browse: 書き込みを持たない（閲覧専用）", !/\b(UPDATE|DELETE|INSERT)\s/i.test(browseSrc.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/「[^」]*」/g, "")) || (!browseSrc.includes("await query(`UPDATE") && !browseSrc.includes("await query(`DELETE") && !browseSrc.includes("await query(`INSERT")));
  check("browse: context の期限切れを既定で除外", browseSrc.includes("effective_until"));
  check("browse: CSV出力（BOMつき）", browseSrc.includes("text/csv"));

  const rowPatchSrc = readFileSync(join(APP_ROOT, "src", "app", "api", "ordo-admin", "corpus", "[kind]", "[rowId]", "route.ts"), "utf-8");
  check("個別検収: status 変更時に reviewed_by を記録", rowPatchSrc.includes('add("reviewed_by"'));
  check("個別検収: context を検収対象に追加", rowPatchSrc.includes("corpus_context"));
  check("個別検収: DELETE を提供しない", !rowPatchSrc.includes("export async function DELETE"));

  // ── 7. X7b: アダプタB（PDF→ナレッジ）・JAGES・海外アダプタ ──
  const mig044Path = join(MIG_DIR, "044_harvest_pdf_sources.sql");
  check("044_harvest_pdf_sources.sql が存在する", existsSync(mig044Path));
  const mig044 = existsSync(mig044Path) ? readFileSync(mig044Path, "utf-8") : "";
  for (const key of ["jages_press", "mhlw_grants", "wsipp", "community_guide"]) {
    check(`044のシードアダプタが実装済み: ${key}`, mig044.includes(`'${key}'`) && key in adapters.HARVEST_ADAPTERS);
  }
  check(
    "044: 追加ソースはすべて enabled=false（無許諾で動き出さない）",
    !/,\s*true\s*,\s*'(full|light|spot)'/.test(mig044.slice(mig044.indexOf("INSERT INTO corpus_sources"))),
  );
  check("044: harvest_source_key の一意インデックス（ON CONFLICT 用）", mig044.includes("UNIQUE INDEX") && mig044.includes("harvest_source_key"));

  check("overseas フラグ: WSIPP・Community Guide は true", adapters.HARVEST_ADAPTERS.wsipp.overseas === true && adapters.HARVEST_ADAPTERS.community_guide.overseas === true);
  check("overseas フラグ: JAGES・厚労科研は false", adapters.HARVEST_ADAPTERS.jages_press.overseas === false && adapters.HARVEST_ADAPTERS.mhlw_grants.overseas === false);
  check("mhlw_grants: mode=pdf_to_knowledge・resolvePdfUrls あり", adapters.HARVEST_ADAPTERS.mhlw_grants.mode === "pdf_to_knowledge" && typeof adapters.HARVEST_ADAPTERS.mhlw_grants.resolvePdfUrls === "function");
  check("アダプタA系は mode 未指定（extract 既定）", adapters.HARVEST_ADAPTERS.jages_press.mode == null && adapters.HARVEST_ADAPTERS.env_best.mode == null);

  // jages_press: NetCommonsダウンロードリンクの抽出
  const jagesHtml = `
    <a href="/?action=common_download_main&upload_id=13321">仮設住宅への転居でうつ発症リスク2倍（プレスリリース）</a>
    <a href="https://www.jages.net/?action=common_download_main&upload_id=3411">地域サロン参加と認知症発症: 7年追跡で0.7倍</a>
    <a href="/?action=common_download_main&upload_id=99999">プレスリリースタグ_220901.xlsx</a>
    <a href="/?action=common_download_main&upload_id=13321">仮設住宅への転居でうつ発症リスク2倍（プレスリリース）</a>
    <a href="/library/pressrelease/2024/">2024年度</a>`;
  const jagesItems = adapters.HARVEST_ADAPTERS.jages_press.listItems(jagesHtml, "https://www.jages.net/library/pressrelease/");
  check("jages_press: upload_id リンクだけを重複なしで拾う", jagesItems.length === 2);
  check("jages_press: xlsx等のデータファイルは拾わない", jagesItems.every((i) => !i.title.includes(".xlsx")));
  check("jages_press: stableId が upload_id 由来で安定", jagesItems[0].stableId === "upload-13321");

  // mhlw_grants: /project/{id} リンクの抽出とPDF解決
  const mhlwHtml = `
    <a href="/project/180181">介護予防の効果検証に関する研究（令和5年度 総括研究報告書）</a>
    <a href="/project/180181">介護予防の効果検証に関する研究（令和5年度 総括研究報告書）</a>
    <a href="/search?keyword=x&page=1">次のページへ進む</a>`;
  const mhlwItems = adapters.HARVEST_ADAPTERS.mhlw_grants.listItems(mhlwHtml, "https://mhlw-grants.niph.go.jp/search?keyword=x");
  check("mhlw_grants: /project/{id} を重複なしで拾う", mhlwItems.length === 1 && mhlwItems[0].stableId === "project-180181");
  const mhlwPdfs = adapters.HARVEST_ADAPTERS.mhlw_grants.resolvePdfUrls(
    `<a href="/system/files/report/202405001A-sokatsu.pdf">総括研究報告書</a><a href="/project/1">別課題ページへのリンク</a>`,
    "https://mhlw-grants.niph.go.jp/project/180181",
  );
  check("mhlw_grants: ページ内のPDFリンクを解決", mhlwPdfs.length === 1 && mhlwPdfs[0].endsWith("-sokatsu.pdf"));

  // 海外アダプタのフィクスチャ
  const wsippItems = adapters.HARVEST_ADAPTERS.wsipp.listItems(
    `<a href="/BenefitCost/Program/123">Nurse Family Partnership program page</a><a href="/About">About the institute page</a>`,
    "https://www.wsipp.wa.gov/BenefitCost",
  );
  check("wsipp: /BenefitCost/Program だけを拾う", wsippItems.length === 1);
  const cgItems = adapters.HARVEST_ADAPTERS.community_guide.listItems(
    `<a href="/findings/physical-activity-something.html">Physical Activity: Community-wide campaigns</a><a href="/about/our-methods.html">About our review methods</a>`,
    "https://www.thecommunityguide.org/pages/task-force-findings.html",
  );
  check("community_guide: /findings/ だけを拾う", cgItems.length === 1);

  // エンジンのアダプタB経路（静的検査）
  check("engine: pdf_to_knowledge 分岐がある", engineSrc.includes("pdf_to_knowledge"));
  check("engine: S3原本保全は corpus-harvest/ プレフィックス", engineSrc.includes("corpus-harvest/${adapter.key}"));
  check("engine: ナレッジ登録は Tier1・pending・冪等", engineSrc.includes("ON CONFLICT (harvest_source_key) DO NOTHING") && /VALUES \(1, \$1/.test(engineSrc));
  check("engine: PDFサイズ上限ガードがある", engineSrc.includes("MAX_PDF_BYTES"));
  check("engine: run に knowledge_docs_created を記録", engineSrc.includes("knowledge_docs_created = $8"));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`check-harvest: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
