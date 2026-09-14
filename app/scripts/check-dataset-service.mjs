#!/usr/bin/env node
/**
 * データセットのサービス層を実 DB で動かす検査 — check:datasetsvc（DB が要るので npm run check には入れない）
 *
 * 使い方:
 *   DATABASE_URL=postgres://… node scripts/check-dataset-service.mjs
 *   （.env.local があればそこから DATABASE_URL を読む）
 *
 * 一時的な自治体・計画を作って、箱の作成 → 版の取込（UTF-8 / Shift_JIS / 拒否）→ 無効化 → ダウンロード →
 * 操作履歴 → 旧 project_datasets 代替の参照、を実行し、最後に一時データを消す（CASCADE）。
 * S3 は使わない（メモリのスタブに差し替える）。
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const require = createRequire(join(APP_ROOT, "package.json"));

// .env.local から DATABASE_URL
if (!process.env.DATABASE_URL) {
  const envPath = join(APP_ROOT, ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要です");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const check = (name, cond) => { if (cond) passed++; else { failed++; console.error(`  ✗ ${name}`); } };

const work = mkdtempSync(join(tmpdir(), "datasetsvc-"));
const stub = join(work, "storage-stub.ts");
writeFileSync(stub, `
const store = new Map();
export async function uploadToStorage(bucket, path, data) { store.set(bucket + "/" + path, Buffer.from(data)); return path; }
export async function downloadFromStorage(bucket, path) { const b = store.get(bucket + "/" + path); if (!b) throw new Error("not found"); return b; }
export function getPublicUrl() { return ""; }
export async function deleteFromStorage() {}
`);
const bundle = join(APP_ROOT, ".check-datasetsvc.mjs");
execFileSync("npx", ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "dataset", "service.ts"),
  "--bundle", "--format=esm", "--platform=node", "--target=es2022", "--packages=external",
  `--alias:@/lib/storage=${stub}`, `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${bundle}`],
  { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT });

const pg = require("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 60_000 });
const q = (s, p) => pool.query(s, p).then((r) => r.rows);
const MUNI = "00000000-0000-4000-8000-00000000d2d2";
const PROJECT = "00000000-0000-4000-8000-00000000d2d3";
const PROJECT_NEUTRAL = "00000000-0000-4000-8000-00000000d2d4";

try {
  const svc = await import(pathToFileURL(bundle).href);
  await q(`INSERT INTO municipalities (id, name, slug, prefecture) VALUES ($1, 'check-datasetsvc', 'check-datasetsvc', '-') ON CONFLICT (id) DO NOTHING`, [MUNI]);
  // 分野パックの解決を検査するため、計画種別を明示する（既定は custom＝分野指定なし）
  await q(`INSERT INTO projects (id, municipality_id, title, plan_type) VALUES ($1, $2, 'check-datasetsvc', 'kaigo_hoken') ON CONFLICT (id) DO UPDATE SET plan_type = 'kaigo_hoken'`, [PROJECT, MUNI]);
  await q(`INSERT INTO projects (id, municipality_id, title, plan_type) VALUES ($1, $2, 'check-datasetsvc-neutral', 'custom') ON CONFLICT (id) DO NOTHING`, [PROJECT_NEUTRAL, MUNI]);
  const actor = { userRoleId: null, municipalityId: MUNI, via: "ui" };

  const tpl = (await svc.listTemplates("kaigo_hoken")).find((t) => t.id === "care_insurance_report");
  check("テンプレートに列定義がある（066）", tpl && Array.isArray(tpl.column_schema));
  const box = await svc.createDataset(actor, PROJECT, { kind: "aggregate", name: "事業状況報告", templateId: tpl.id, columnSchema: tpl.column_schema });
  check("箱ができる", box.id && box.kind === "aggregate");
  try { await svc.createDataset(actor, PROJECT, { kind: "aggregate", name: "x", columnSchema: [{ name: "a", role: "dimension", type: "text" }] }); check("measure 無しの列定義は拒否", false); } catch (e) { check("measure 無しの列定義は拒否", e.status === 400); }
  try { await svc.createDataset(actor, PROJECT, { kind: "individual", name: "x", attrKeys: ["id.address_code"] }); check("庁内限定の属性は個票の箱に入れられない", false); } catch (e) { check("庁内限定の属性は個票の箱に入れられない", e.status === 400); }
  const ind = await svc.createDataset(actor, PROJECT, { kind: "individual", name: "個票", attrKeys: ["care.level", "demo.sex"] });
  check("個票の箱はできる（版は D5）", ind.kind === "individual");

  // ── 辞書の3層（分野を固定しないこと）─────────────────────
  const dictCare = await svc.resolveDictionary(PROJECT, MUNI);
  const dictNeutral = await svc.resolveDictionary(PROJECT_NEUTRAL, MUNI);
  check("コアの属性はどちらの計画でも出る", ["demo.age_band5", "demo.sex", "prog.participated"].every((k) => dictCare.some((d) => d.key === k) && dictNeutral.some((d) => d.key === k)));
  check("分野パックの属性はその分野の計画にだけ出る",
    dictCare.some((d) => d.key === "care.level" && d.origin === "domain") && !dictNeutral.some((d) => d.key === "care.level"));
  check("分野が未設定の計画でもコアの属性で個票の箱は作れる",
    (await svc.createDataset(actor, PROJECT_NEUTRAL, { kind: "individual", name: "分野なし個票", attrKeys: ["demo.sex", "prog.participated"] })).kind === "individual");
  try {
    await svc.createDataset(actor, PROJECT_NEUTRAL, { kind: "individual", name: "x", attrKeys: ["care.level"] });
    check("他分野の属性は選べない", false);
  } catch (e) { check("他分野の属性は選べない", e.status === 400); }
  check("値の語彙が未設定の属性（地区）はまだ選べない", !dictCare.some((d) => d.key === "demo.area" && Object.keys(d.codes ?? {}).length > 0));
  try { await svc.createDataset(actor, PROJECT, { kind: "individual", name: "x", attrKeys: ["demo.area"] }); check("語彙未設定の属性は拒否", false); } catch (e) { check("語彙未設定の属性は拒否", e.status === 400); }
  await svc.upsertTenantAttribute(actor, PROJECT, {
    key: "demo.area", label: "地区", description: "自団体の区分", valueType: "code",
    codes: { a1: "中央", a2: "東部" }, role: "quasi_identifier", timeGranularity: "fiscal_year",
  });
  const dict2 = await svc.resolveDictionary(PROJECT, MUNI);
  const areaDef = dict2.find((d) => d.key === "demo.area");
  check("テナント拡張で値の語彙を登録すると使えるようになる", areaDef.origin === "tenant" && areaDef.codes.a1 === "中央");
  check("拡張後は個票の箱に選べる",
    (await svc.createDataset(actor, PROJECT, { kind: "individual", name: "地区つき個票", attrKeys: ["demo.area"] })).kind === "individual");
  const newAttr = await svc.upsertTenantAttribute(actor, PROJECT, {
    key: "local.support_group", label: "支援区分", description: "自団体だけの区分", valueType: "code",
    codes: { g1: "A", g2: "B" }, role: "quasi_identifier", timeGranularity: "fiscal_year",
  });
  check("自団体だけの新しい属性も登録できる（準識別子のはしごは自動）",
    newAttr.origin === "tenant" && newAttr.generalization && newAttr.generalization.levels.length === 1);
  try { await svc.upsertTenantAttribute(actor, PROJECT, { key: "bad key", label: "x", valueType: "bool", role: "neutral", timeGranularity: "static" }); check("キーの形式を弾く", false); } catch (e) { check("キーの形式を弾く", e.status === 400); }

  // ── キー種別（庁内キーの語彙）─────────────────────────────
  const kt0 = await svc.listKeyTypes(MUNI);
  check("共通のキー種別は宛名番号だけ", kt0.filter((k) => !k.municipalityId).length === 1 && kt0[0].code === "atena" && kt0[0].isPrimary === true);
  const kt = await svc.createKeyType(actor, PROJECT, { code: "shikaku01", label: "○○業務システムの整理番号", normalization: { style: "digits", zeroPad: 10 } });
  check("自団体のキー種別を登録できる", kt.code === "shikaku01" && kt.normalization.zeroPad === 10);
  try { await svc.createKeyType(actor, PROJECT, { code: "shikaku01", label: "重複", normalization: { style: "digits" } }); check("同じコードは拒否（sid の導出に入るため）", false); } catch (e) { check("同じコードは拒否（sid の導出に入るため）", e.status === 409); }
  try { await svc.createKeyType(actor, PROJECT, { code: "Bad-Code", label: "x", normalization: { style: "digits" } }); check("コードの形式を弾く", false); } catch (e) { check("コードの形式を弾く", e.status === 400); }
  check("キー種別の一覧に自団体分が入る", (await svc.listKeyTypes(MUNI)).some((k) => k.code === "shikaku01" && k.municipalityId === MUNI));

  const csv = "﻿年度,月,第1号被保険者数,認定者数,認定率,受給者数,受給率,給付費\n令和7年度,,5100,1020,20.0%,900,17.6,\"1,234,567\"\n2026,4,5200,1050,20.2,910,17.5,1300000\n";
  const r1 = await svc.addAggregateVersion(actor, PROJECT, box.id, { asOf: "2026-03-31", fileName: "report.csv", bytes: new TextEncoder().encode(csv) });
  check("UTF-8（BOM 付き）の CSV を取り込める", r1.version.status === "validated" && r1.accepted === 2 && r1.encoding === "utf-8");
  const rows = await q(`SELECT row_no, dims, period::text AS period, measures FROM dataset_rows WHERE dataset_version_id = $1 ORDER BY row_no`, [r1.version.id]);
  check("行が保存され、和暦年度・カンマ・％を吸収する", rows.length === 2 && rows[0].period === "2025-04-01" && rows[0].measures["給付費"] === 1234567 && rows[0].measures["認定率"] === 20);
  // Shift_JIS（python の '…'.encode('shift_jis') で作った実バイト列。CRLF）
  const sjis = Uint8Array.from(Buffer.from("944e93782c91e6318d8694ed95db8caf8ed290942c944692e88ed290942c944692e897a62c8ef38b8b8ed290942c8ef38b8b97a62c8b8b957494ef0d0a323032342c353030302c313030302c32302c3838302c31372e362c313030303030300d0a", "hex"));
  const r2 = await svc.addAggregateVersion(actor, PROJECT, box.id, { asOf: "2025-03-31", fileName: "sjis.csv", bytes: sjis });
  check("Shift_JIS のヘッダを復号して取り込める", r2.version.status === "validated" && r2.encoding === "shift_jis");
  const r3 = await svc.addAggregateVersion(actor, PROJECT, box.id, { asOf: "2026-03-31", fileName: "bad.csv", bytes: new TextEncoder().encode("年度,認定者数\n2026,1\n") });
  check("列が足りない版は rejected で行を取り込まない", r3.version.status === "rejected" && r3.version.reject_reasons.missing_columns.length > 0);
  const mn = "123456789018";
  const r4 = await svc.addAggregateVersion(actor, PROJECT, box.id, { asOf: "2026-03-31", fileName: "mn.csv", bytes: new TextEncoder().encode(`年度,第1号被保険者数,認定者数,認定率,受給者数,受給率,給付費,備考\n2026,1,1,1,1,1,1,${mn}\n`) });
  check("個人番号様の値がある版は rejected で、ファイルも値も保存しない", r4.version.status === "rejected" && r4.version.storage_path === null && !JSON.stringify(r4.version.reject_reasons).includes(mn));
  const r5 = await svc.addAggregateVersion(actor, PROJECT, box.id, { asOf: "2026-03-31", fileName: "num.csv", bytes: new TextEncoder().encode("年度,第1号被保険者数,認定者数,認定率,受給者数,受給率,給付費\n2026,abc,1,1,1,1,1\n") });
  check("数値でない値は行の位置と理由が返る", r5.version.status === "rejected" && r5.errors[0].row === 1 && r5.errors[0].column === "第1号被保険者数");
  try { await svc.addAggregateVersion(actor, PROJECT, ind.id, { asOf: "2026-03-31", fileName: "x.csv", bytes: new TextEncoder().encode("a\n1\n") }); check("個票の箱への CSV は 501", false); } catch (e) { check("個票の箱への CSV は 501", e.status === 501); }

  const mine = (await svc.listDatasets(PROJECT)).find((d) => d.id === box.id);
  check("一覧: 版数と最新の基準日（有効な版だけ）", mine.version_count === 5 && mine.latest_as_of === "2026-03-31" && mine.latest_status === "validated");
  const latest = (await svc.latestVersionsByTemplate(PROJECT)).find((v) => v.dataset_id === box.id);
  check("旧 project_datasets 代替: 箱ごとの最新の有効な版", latest && latest.version_id === r1.version.id && latest.template_id === "care_insurance_report");
  const rej = await svc.rejectVersion(actor, PROJECT, box.id, r1.version.id, "誤り");
  check("無効化しても行は消えない", rej.status === "rejected" && (await q(`SELECT count(*)::int AS c FROM dataset_rows WHERE dataset_version_id=$1`, [r1.version.id]))[0].c === 2);
  const latest2 = (await svc.latestVersionsByTemplate(PROJECT)).find((v) => v.dataset_id === box.id);
  check("無効化後は次の有効な版が最新になる", latest2 && latest2.as_of === "2025-03-31");
  const dl = await svc.downloadVersion(actor, PROJECT, box.id, r1.version.id);
  check("ダウンロードは上げたものと同じ内容", dl.bytes.toString("utf8") === csv);
  const act = await svc.versionActivity(r1.version.id);
  check("操作履歴に取込・無効化・ダウンロードが残る", act.map((a) => a.action).sort().join(",") === "download,ingest,reject");
  const dlg = { ...actor, via: "dialogue", dialogueRef: { dialogue_kind: "measure", dialogue_id: "x", turn_no: 3 } };
  const box2 = await svc.createDataset(dlg, PROJECT, { kind: "aggregate", name: "AI提案", columnSchema: [{ name: "年度", role: "time", type: "fiscal_year" }, { name: "値", role: "measure", type: "numeric" }] });
  const log = await q(`SELECT via, dialogue_ref FROM activity_log WHERE entity='dataset' AND entity_id=$1`, [box2.id]);
  check("AI 経路でも同じ activity_log に via='dialogue' と対話参照が残る", log[0].via === "dialogue" && log[0].dialogue_ref.turn_no === 3 && box2.created_via === "dialogue");
  check("別計画の箱は取れない", (await svc.getDataset("00000000-0000-4000-8000-000000000000", box.id)) === null);
} finally {
  await q(`DELETE FROM municipalities WHERE id = $1`, [MUNI]).catch(() => {});
  await pool.end();
  rmSync(work, { recursive: true, force: true });
  rmSync(bundle, { force: true });
}
console.log(`\ncheck:datasetsvc — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
