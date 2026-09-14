#!/usr/bin/env node
/**
 * データセット（器）の検査 — check:dataset
 *
 * 設計: claude/coe-dataset-model.md（第Ⅰ部）
 *
 * この検査を作った理由:
 *   ①**個人を特定しうる列がどの表にも無いこと**を構造で固定する（列が無ければ入らない）。
 *   ②sid の導出が決定的で、計画・キー種別ごとに分かれ、鍵無しでは作れないこと。
 *   ③キー種別の正規化規則が凍結されていること（規則を変えると sid が変わる＝ローテーション扱い）。
 *   ④個人番号（マイナンバー）が導出の入力になれず、値としても機械で止まること。
 *   ⑤属性辞書に自由記述型が無く、準識別子には粗化のはしごがあり、既定は持ち込み不可であること。
 *     マイグレーションの初期投入が辞書の正本（dictionary.ts）と食い違っていないこと。
 *   ⑥k-匿名性の強制が、閾値未満のセルを通さないこと。抑制件数を隠さないこと。
 *   ⑦集計データの13テンプレートの列定義が構造検査を通ること。
 *
 * 使い方:
 *   node scripts/check-dataset.mjs
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
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// 規則の凍結。変えるときは設計 §6-5 のとおりローテーション扱い（旧→新の別名ペアが要る）
const FROZEN_KEY_TYPES_FINGERPRINT =
  "atena:^\\d{1,15}$:0:0|hihokensha:^\\d{10}$:10:0|kokuho:^[0-9A-Z]{1,10}-[0-9A-Z]{1,10}$:0:1|" +
  "kouki:^\\d{8}$:8:0|kenshin:^[0-9A-Z-]{1,20}$:0:1|shogai:^\\d{10}$:10:0|seiho:^\\d{1,10}-\\d{1,3}$:0:1";

const work = mkdtempSync(join(tmpdir(), "dataset-"));
try {
  const file = join(work, "dataset.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "dataset", "index.ts"),
     "--bundle", "--format=esm", "--platform=node", "--target=es2020", `--outfile=${file}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(file).href);

  // ── 1. キー種別と正規化 ─────────────────────────
  console.log("1. キー種別と正規化");
  check("規則の指紋が凍結値と一致する", m.keyTypesFingerprint() === FROZEN_KEY_TYPES_FINGERPRINT);
  check("個人番号を表すキー種別が語彙に無い",
    !m.KEY_TYPES.some((k) => /my|kojin|個人番号|mynumber/i.test(k.type + k.label)));
  check("宛名番号: 全角・空白を吸収し先頭ゼロを保持する",
    m.normalizeKey("atena", "　０００１２３４５ ").ok && m.normalizeKey("atena", "　０００１２３４５ ").value === "00012345");
  check("被保険者番号: 10桁にゼロ埋め", m.normalizeKey("hihokensha", "123456").value === "0000123456");
  check("国保: 記号と番号をハイフン1つで結合", m.normalizeKey("kokuho", "12 － 345678").value === "12-345678");
  check("未知のキー種別は拒否", m.normalizeKey("mynumber", "123456789018").ok === false);
  check("空は拒否", m.normalizeKey("atena", "  ").ok === false && m.normalizeKey("atena", "  ").reason === "empty");
  check("形式不一致は拒否", m.normalizeKey("kouki", "ABC").ok === false);

  // ── 2. sid の導出 ────────────────────────────────
  console.log("2. sid の導出");
  const K1 = Buffer.alloc(32, 1);
  const K2 = Buffer.alloc(32, 2);
  const P1 = "22222222-2222-2222-2222-222222222222";
  const P2 = "33333333-3333-3333-3333-333333333333";
  const a = m.deriveSid(K1, P1, "atena", "00012345");
  check("導出できる", a.ok === true && m.isValidSid(a.sid));
  check("決定的（同じ入力 → 同じ sid）", m.deriveSid(K1, P1, "atena", "00012345").sid === a.sid);
  check("宛名番号は先頭ゼロの有無で別人（ゼロ埋めしない）", m.deriveSid(K1, P1, "atena", "12345").sid !== a.sid);
  check("正規化前の表記ゆれでも同じ sid", m.deriveSid(K1, P1, "atena", "　０００１２３４５").sid === a.sid);
  check("計画が違えば別の sid", m.deriveSid(K1, P2, "atena", "00012345").sid !== a.sid);
  check("キー種別が違えば別の sid", m.deriveSid(K1, P1, "hihokensha", "0000012345").sid !== a.sid);
  check("鍵が違えば別の sid", m.deriveSid(K2, P1, "atena", "00012345").sid !== a.sid);
  check("鍵の長さが違えば拒否", m.deriveSid(Buffer.alloc(16, 1), P1, "atena", "1").ok === false);
  check("計画 ID が UUID でなければ拒否", m.deriveSid(K1, "plan-1", "atena", "1").ok === false);
  check("sid は S + 20 文字", a.sid.length === 21 && a.sid.startsWith("S"));
  check("Crockford Base32（I L O U を含まない）", !/[ILOU]/.test(a.sid.slice(1)));
  check("鍵 ID は 8 桁の16進", /^[0-9a-f]{8}$/.test(m.keyId(K1)) && m.keyId(K1) !== m.keyId(K2));
  check("生成した鍵は 32 バイトで毎回異なる",
    m.generateKey().length === 32 && !m.generateKey().equals(m.generateKey()));
  check("16進の往復", m.keyFromHex(m.keyToHex(K2)).equals(K2) && m.keyFromHex("zz") === null);

  // ── 3. 個人番号ガード ────────────────────────────
  console.log("3. 個人番号ガード");
  // 独立実装で検査用数字を求める（平成26年総務省令第85号 第5条）
  const indep = (body) => {
    const p = body.split("").reverse().map(Number);
    let s = 0;
    for (let n = 1; n <= 11; n++) s += p[n - 1] * (n <= 6 ? n + 1 : n - 5);
    const r = s % 11;
    return r <= 1 ? 0 : 11 - r;
  };
  let agree = true;
  for (let i = 0; i < 200; i++) {
    const body = String(Math.floor(Math.random() * 1e11)).padStart(11, "0");
    if (m.myNumberCheckDigit(body) !== indep(body)) agree = false;
  }
  check("検査用数字の算式が独立実装と一致する（200件）", agree);
  const valid = "12345678901" + m.myNumberCheckDigit("12345678901");
  check("成立する12桁は検出する", m.looksLikeMyNumber(valid));
  check("ハイフン・空白・全角でも検出する",
    m.looksLikeMyNumber(valid.replace(/(\d{4})(\d{4})(\d{4})/, "$1-$2 $3").replace(/1/g, "１")));
  check("検査用数字が合わない12桁は検出しない", !m.looksLikeMyNumber("12345678901" + ((Number(valid[11]) + 1) % 10)));
  check("11桁・13桁は検出しない", !m.looksLikeMyNumber("12345678901") && !m.looksLikeMyNumber(valid + "1"));
  const hits = m.scanForMyNumber([{ a: "x", b: valid }, { a: valid, b: "y" }]);
  check("表の走査は位置だけ返し値は返さない",
    hits.length === 2 && hits[0].row === 1 && hits[0].column === "b" && !JSON.stringify(hits).includes(valid));

  // ── 4. 属性辞書 ──────────────────────────────────
  console.log("4. 属性辞書");
  const dict = m.CARE_INSURANCE_DICTIONARY;
  check("辞書の構造検査が通る", m.validateDictionary(dict).length === 0);
  check("自由記述型が無い", !dict.some((d) => d.valueType === "text"));
  check("準識別子はすべて粗化のはしごを持つ",
    dict.filter((d) => d.role === "quasi_identifier").every((d) => d.generalization));
  check("庁内限定の属性（cloudAllowed=false）が存在し、例として町丁目コードがそれ",
    dict.some((d) => d.key === "id.address_code" && d.cloudAllowed === false));
  check("要介護度は経年比較のため month 粒度",
    dict.find((d) => d.key === "care.level")?.timeGranularity === "month");
  check("辞書の構造検査は自由記述型を弾く",
    m.validateDictionary([{ key: "x.y", label: "", description: "", valueType: "text", role: "neutral", timeGranularity: "static", cloudAllowed: true }]).length > 0);
  check("辞書の構造検査は写像漏れを弾く",
    m.validateDictionary([{ key: "x.y", label: "", description: "", valueType: "code", codes: { a: "A", b: "B" }, role: "quasi_identifier",
      generalization: { priority: 1, levels: [{ label: "l", map: { a: "*" } }] }, timeGranularity: "static", cloudAllowed: true }]).length > 0);

  // ── 5. 粗化と k-匿名性 ───────────────────────────
  console.log("5. 粗化と k-匿名性");
  check("年齢 → 5歳階級", m.ageToBand5(67) === "65-69" && m.ageToBand5(39) === "u40" && m.ageToBand5(101) === "100+" && m.ageToBand5(-1) === null);
  const age = dict.find((d) => d.key === "demo.age_band5");
  check("はしごを上げると粗くなる", m.generalizeCode(age, "65-69", 1) === "60-69" && m.generalizeCode(age, "65-69", 2) === "u65_or_65-74");
  check("段数を超えると削除（*）", m.generalizeCode(age, "65-69", 9) === "*");
  check("写像に無いコードは null", m.generalizeCode(age, "bogus", 1) === null);

  // 合成データ: 圏域2 × 性別2 × 年齢2 のセル。1セルだけ 3 人にする
  const rows = [];
  let n = 0;
  const mk = (area, sex, band, count, dem) => {
    for (let i = 0; i < count; i++) rows.push({ sid: "S" + String(n++).padStart(20, "0"), values: { "demo.area": area, "demo.sex": sex, "demo.age_band5": band, "health.dementia_level": dem[i % dem.length] } });
  };
  mk("area01", "M", "70-74", 12, ["none", "I"]);
  mk("area01", "F", "70-74", 12, ["none", "I"]);
  mk("area02", "M", "75-79", 12, ["IIa", "IIb"]);
  mk("area02", "F", "75-79", 12, ["none"]); // 機微が1値に偏る
  mk("area02", "F", "85-89", 3, ["none", "I"]); // 小さいセル
  const r = m.enforceAnonymity(rows, dict, { k: 10, l: 2 });
  check("結果は k を満たす", r.ok && r.kObserved >= 10);
  check("はしごを上げても満たせない行は抑制され、件数が返る", r.suppressed > 0 && r.rows.length + r.suppressed === rows.length);
  check("圏域（priority 1）が先に粗くなる", (r.levels["demo.area"] ?? 0) >= 1);
  check("粗化後の値が出力に反映される", r.rows.every((x) => x.values["demo.area"] === "*" || x.values["demo.area"] === undefined || !String(x.values["demo.area"]).startsWith("area")) || r.levels["demo.area"] === 0);
  const rowsL = [];
  n = 0;
  mk("area01", "M", "70-74", 12, ["none"]); // k は満たすが機微が1値
  mk("area01", "F", "70-74", 12, ["none", "I"]);
  const rL = m.enforceAnonymity(rows.slice(-24), dict, { k: 10, l: 2 });
  check("機微属性が1値に偏るセルではその属性が * になる（k は満たしても）",
    rL.suppressed === 0 && rL.sensitiveDropped["health.dementia_level"] === 12 &&
    rL.rows.filter((x) => x.values["health.dementia_level"] === "*").length === 12);
  void rowsL;
  const big = [];
  for (let i = 0; i < 40; i++) big.push({ sid: "S" + String(i).padStart(20, "0"), values: { "demo.sex": i % 2 ? "M" : "F" } });
  const r2 = m.enforceAnonymity(big, dict, { k: 10, l: 2 });
  check("十分大きいセルは粗化も抑制もされない", r2.suppressed === 0 && r2.levels["demo.sex"] === 0 && r2.rows.length === 40);
  check("空入力でも落ちない", m.enforceAnonymity([], dict, { k: 10, l: 2 }).ok);

  // ── 6. 五つ組への展開 ────────────────────────────
  console.log("6. 五つ組への展開");
  const sex = dict.find((d) => d.key === "demo.sex");
  check("時点の丸め: month → 月初 / fiscal_year → 年度開始日 / static → 1900-01-01",
    m.observedAtFor(dict.find((d) => d.key === "care.level"), "2026-09-14") === "2026-09-01" &&
    m.observedAtFor(age, "2026-03-31") === "2025-04-01" &&
    m.observedAtFor(sex, "2026-09-14") === "1900-01-01");
  const w = m.wideToObservations(
    [
      { sid: a.sid, values: { "demo.sex": "M", "care.level": "care1", "outcome.cert_new": "有", "outcome.benefit_amount": "1,234" } },
      { sid: a.sid.slice(0, 5), values: { "demo.sex": "M" } },
      { sid: m.deriveSid(K1, P1, "atena", "2").sid, values: { "demo.sex": "Q", "id.address_code": "x", "free.text": "a", "outcome.benefit_amount": valid } },
    ],
    dict, "2026-09-14",
  );
  check("正しい行は展開される（4 属性 → 4 観測）", w.observations.filter((o) => o.sid === a.sid).length === 4 && w.accepted === 1);
  check("値は型に応じて1列だけ",
    w.observations.every((o) => ["valueCode", "valueNum", "valueBool"].filter((k) => o[k] !== undefined).length === 1));
  check("bool の日本語表記を吸収", w.observations.find((o) => o.attrKey === "outcome.cert_new")?.valueBool === true);
  check("カンマ付き数値を吸収", w.observations.find((o) => o.attrKey === "outcome.benefit_amount" && o.sid === a.sid)?.valueNum === 1234);
  const reasons = Object.fromEntries(w.rejects.map((x) => [x.reason + ":" + (x.attrKey ?? ""), x.count]));
  check("sid が不正な行は拒否", reasons["missing_sid:"] === 1);
  check("不正なコードは拒否", reasons["invalid_code:demo.sex"] === 1);
  check("庁内限定の属性は拒否", reasons["not_cloud_allowed:id.address_code"] === 1);
  check("辞書に無い属性は拒否", reasons["unknown_attr:free.text"] === 1);
  check("個人番号様の値は拒否", reasons["looks_like_my_number:outcome.benefit_amount"] === 1);
  check("拒否の記録に値そのものが無い", !JSON.stringify(w.rejects).includes(valid));

  // ── 7. 集計データの列定義 ────────────────────────
  console.log("7. 集計データの列定義");
  const mig = read(join(REPO_ROOT, "infra", "migrations", "066_datasets_individual.sql"));
  check("066 が存在する", mig.length > 0);
  const schemas = [...mig.matchAll(/SET column_schema = '(\[[\s\S]*?\])'::jsonb/g)].map((x) => JSON.parse(x[1]));
  check("12 件の集計テンプレートに列定義がある", schemas.length === 12);
  check("すべての列定義が構造検査を通る", schemas.every((s) => m.validateColumnSchema(s).length === 0));
  const cir = schemas.find((s) => s.some((c) => c.name === "第1号被保険者数"));
  const v = m.validateAggregateRows(cir, [
    { 年度: "令和8年度", 月: "", 第1号被保険者数: "5,100", 認定者数: "1,020", 認定率: "20.0%", 受給者数: "900", 受給率: "17.6", 給付費: "1234567" },
    { 年度: "2026", 第1号被保険者数: "x", 認定者数: "1", 認定率: "1", 受給者数: "1", 受給率: "1", 給付費: "1" },
  ], "2026-04-01");
  check("和暦の年度を正規化し、数値のカンマ・％を吸収する",
    v.rows.length === 1 && v.rows[0].period === "2026-04-01" && v.rows[0].measures["第1号被保険者数"] === 5100 && v.rows[0].measures["認定率"] === 20);
  check("数値でない measure は行ごと拒否し、位置だけ返す", v.errors.length === 1 && v.errors[0].row === 2 && v.errors[0].column === "第1号被保険者数");
  check("列定義の構造検査は measure 無しを弾く", m.validateColumnSchema([{ name: "a", role: "dimension", type: "text" }]).length > 0);

  // ── 8. マイグレーション 066 の構造 ───────────────
  console.log("8. マイグレーション 066 の構造");
  check("冪等（IF NOT EXISTS）", !/CREATE TABLE (?!IF NOT EXISTS)/.test(mig) && !/ADD COLUMN (?!IF NOT EXISTS)/.test(mig));
  for (const t of ["attribute_definitions", "datasets", "dataset_versions", "dataset_rows", "subjects", "sid_aliases",
    "observations", "cohorts", "cohort_members", "experiment_assignments", "release_requests", "activity_log"]) {
    check(`066 が ${t} を作る`, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`).test(mig));
  }
  const obsDef = mig.slice(mig.indexOf("CREATE TABLE IF NOT EXISTS observations ("), mig.indexOf("CREATE INDEX IF NOT EXISTS idx_observations_attr"));
  check("observations に個人を特定しうる列が無い",
    !/\b(name|kana|address|birth|phone|tel|email|my_number|atena|hihokensha)\b/i.test(obsDef.replace(/--[^\n]*/g, "")));
  check("observations に自由記述列が無い（TEXT は sid と attr_key と value_code だけ）",
    (obsDef.replace(/--[^\n]*/g, "").match(/\bTEXT\b/g) ?? []).length === 3);
  check("observations の値は1列だけ（CHECK num_nonnulls）", /num_nonnulls\(value_code, value_num, value_bool\) = 1/.test(obsDef));
  check("attr_key は辞書への外部キー", /attr_key\s+TEXT NOT NULL REFERENCES attribute_definitions\(key\)/.test(obsDef));
  check("属性辞書に 'text' 型が無い", /value_type IN \('code','band','int','numeric','bool','month','fiscal_year'\)/.test(mig));
  check("属性辞書の cloud_allowed の既定は false", /cloud_allowed\s+BOOLEAN NOT NULL DEFAULT false/.test(mig));
  check("準識別子はしご必須の CHECK がある", /role <> 'quasi_identifier' OR generalization IS NOT NULL/.test(mig));
  check("鍵そのものの列が無い（key_id のみ）", /key_id\s+TEXT/.test(mig) && !/\bkey_bytes\b|\bsecret\b|\bhmac_key\b/i.test(mig));
  check("care_cert_anonymized は個票種別へ", /kind = 'individual',[\s\S]*?WHERE id = 'care_cert_anonymized'/.test(mig));
  check("project_datasets は 066 では落とさない（D2 で API を切り替えてから）", !/DROP TABLE[^;]*project_datasets/.test(mig));
  check("移行は再実行しても増えない（ingest_key = legacy:<旧id>）", /'legacy:' \|\| pd\.id::text/.test(mig) && /NOT EXISTS \(SELECT 1 FROM dataset_versions v WHERE v\.ingest_key/.test(mig));
  const seeded = dict.filter((d) => mig.includes(`('${d.key}',`));
  check("辞書の正本のキーがすべて 066 に投入されている", seeded.length === dict.length);
  check("066 の辞書投入は共通辞書（municipality_id IS NULL）だけを更新する", /WHERE attribute_definitions\.municipality_id IS NULL/.test(mig));
  check("activity_log の via の語彙が閉じている", /via\s+TEXT NOT NULL CHECK \(via IN \('ui','bulk','gap_analysis','dialogue','evaluation','auto_tasks','migration'\)\)/.test(mig));

  // ── 9. マニュアル・サイドバー ────────────────────
  console.log("9. マニュアル");
  const manual = read(join(APP_ROOT, "src", "content", "manual", "datasets.md"));
  check("datasets.md が箱と版・個票・鍵方式を説明している",
    /箱/.test(manual) && /版/.test(manual) && /個票/.test(manual) && /鍵/.test(manual) && /対応表/.test(manual));
  check("datasets.md の frontmatter に 066 と新テーブルがある", /066/.test(manual) && /observations/.test(manual) && /datasets/.test(manual));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck:dataset — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
