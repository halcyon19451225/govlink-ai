#!/usr/bin/env node
/**
 * データセット（器）の検査 — check:dataset
 *
 * 設計: claude/coe-dataset-model.md（第Ⅰ部）
 *
 * この検査を作った理由:
 *   ①**個人を特定しうる列がどの表にも無いこと**を構造で固定する（列が無ければ入らない）。
 *   ②sid の導出が決定的で、計画・キー種別ごとに分かれ、鍵無しでは作れないこと。
 *   ③正規化の挙動が型ごとに凍結されていること（変えると sid が変わる＝ローテーション扱い）。
 *   ④個人番号（マイナンバー）が導出の語彙になく、値としても機械で止まること。
 *   ⑤**辞書が分野で固定されていないこと** — コアは分野中立、分野固有は分野パック、
 *     値の語彙が自治体ごとに違うものはテナント拡張。DB の投入が正本と一致すること。
 *   ⑥k-匿名性の強制が、閾値未満のセルを通さないこと。抑制件数を隠さないこと。
 *   ⑦集計データのテンプレートの列定義が構造検査を通ること。
 *   ⑧API がサービス層を通り、テナント境界・権限を必ず通ること。
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

/**
 * 正規化の挙動の凍結。**型を増やすのは可。既存の型の挙動を変えると落ちる**
 * （同じ庁内キーから別の sid が出てしまうため）。
 * 変えるときは設計 §6-3 のローテーション手順（旧→新の別名ペア）が要る。
 */
const FROZEN_NORMALIZATION = {
  digits: "123|001234|00000123|!empty",
  alnum: "AB123|001234|123|!empty",
  alnum_sep: "AB-123|0012-34|123|!empty",
};

const work = mkdtempSync(join(tmpdir(), "dataset-"));
try {
  const file = join(work, "dataset.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "dataset", "index.ts"),
     "--bundle", "--format=esm", "--platform=node", "--target=es2022", `--outfile=${file}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(file).href);

  // ── 1. 正規化（分野に依存しない「型」だけを持つ） ──────
  console.log("1. 庁内キーの正規化");
  check("正規化の型が3つ（digits / alnum / alnum_sep）", m.NORMALIZATION_STYLES.length === 3);
  for (const [style, frozen] of Object.entries(FROZEN_NORMALIZATION)) {
    check(`${style}: 挙動が凍結値と一致する`, m.normalizationFingerprint(style) === frozen);
  }
  check("数字: 全角・空白を吸収し先頭ゼロを保持",
    m.normalizeKey({ style: "digits" }, "　０００１２３４５ ").value === "00012345");
  check("数字: 桁数指定でゼロ埋め", m.normalizeKey({ style: "digits", zeroPad: 10 }, "123456").value === "0000123456");
  check("英数字: 大文字化して記号を落とす", m.normalizeKey({ style: "alnum" }, "ab-123").value === "AB123");
  check("英数字＋区切り: ハイフンを1つに整える", m.normalizeKey({ style: "alnum_sep" }, "12 － 345678").value === "12-345678");
  check("未知の型は拒否", m.normalizeKey({ style: "mynumber" }, "1").ok === false);
  check("空は拒否", m.normalizeKey({ style: "digits" }, "  ").reason === "empty");
  check("長さの下限・上限で弾ける",
    m.normalizeKey({ style: "digits", minLength: 8 }, "123").reason === "too_short" &&
    m.normalizeKey({ style: "digits", maxLength: 4 }, "123456").reason === "too_long");
  check("規則の構造検査: 型の誤り・ゼロ埋めの不整合を弾く",
    m.validateNormalization({ style: "bogus" }).length > 0 &&
    m.validateNormalization({ style: "alnum", zeroPad: 4 }).length > 0 &&
    m.validateNormalization({ style: "digits", zeroPad: 99 }).length > 0 &&
    m.validateNormalization({ style: "digits", zeroPad: 10 }).length === 0);
  check("コアはキー種別を列挙しない（分野・自治体ごとに違うため DB に登録する）",
    !/KEY_TYPES\b/.test(read(join(APP_ROOT, "src", "lib", "dataset", "keyTypes.ts"))));
  check("キー種別のコードの形式が決まっている", m.KEY_TYPE_CODE_RE.test("atena") && !m.KEY_TYPE_CODE_RE.test("Atena") && !m.KEY_TYPE_CODE_RE.test("1a"));

  // ── 2. sid の導出 ────────────────────────────────
  console.log("2. sid の導出");
  const K1 = Buffer.alloc(32, 1);
  const K2 = Buffer.alloc(32, 2);
  const P1 = "22222222-2222-2222-2222-222222222222";
  const P2 = "33333333-3333-3333-3333-333333333333";
  const R = { style: "digits" };
  const a = m.deriveSid(K1, P1, "atena", R, "00012345");
  check("導出できる", a.ok === true && m.isValidSid(a.sid));
  check("決定的（同じ入力 → 同じ sid）", m.deriveSid(K1, P1, "atena", R, "00012345").sid === a.sid);
  check("表記ゆれを吸収しても同じ sid", m.deriveSid(K1, P1, "atena", R, "　０００１２３４５").sid === a.sid);
  check("計画が違えば別の sid", m.deriveSid(K1, P2, "atena", R, "00012345").sid !== a.sid);
  check("キー種別が違えば別の sid", m.deriveSid(K1, P1, "hihokensha", R, "00012345").sid !== a.sid);
  check("鍵が違えば別の sid", m.deriveSid(K2, P1, "atena", R, "00012345").sid !== a.sid);
  check("鍵の長さが違えば拒否", m.deriveSid(Buffer.alloc(16, 1), P1, "atena", R, "1").ok === false);
  check("計画 ID が UUID でなければ拒否", m.deriveSid(K1, "plan-1", "atena", R, "1").ok === false);
  check("キー種別のコードが不正なら拒否", m.deriveSid(K1, P1, "Atena!", R, "1").reason === "bad_key_type");
  check("sid は S + 20 文字", a.sid.length === 21 && a.sid.startsWith("S"));
  check("Crockford Base32（I L O U を含まない）", !/[ILOU]/.test(a.sid.slice(1)));
  check("鍵 ID は 8 桁の16進", /^[0-9a-f]{8}$/.test(m.keyId(K1)) && m.keyId(K1) !== m.keyId(K2));
  check("生成した鍵は 32 バイトで毎回異なる", m.generateKey().length === 32 && !m.generateKey().equals(m.generateKey()));
  check("16進の往復", m.keyFromHex(m.keyToHex(K2)).equals(K2) && m.keyFromHex("zz") === null);

  // ── 3. 個人番号ガード ────────────────────────────
  console.log("3. 個人番号ガード");
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

  // ── 4. 属性辞書 — 分野で固定されていないこと ─────
  console.log("4. 属性辞書（コア／分野パック／テナント拡張）");
  const core = m.CORE_DICTIONARY;
  const packs = m.DOMAIN_PACKS;
  check("コア辞書の構造検査が通る", m.validateDictionary(core).length === 0);
  check("コア辞書はすべて planTypes が空（どの分野でも出る）", core.every((d) => (d.planTypes ?? []).length === 0));
  check("分野パックが2つ以上ある（枠組みが1分野に寄っていないことの実証）", packs.length >= 2);
  for (const p of packs) {
    check(`分野パック ${p.planType}: 構造検査が通る`, m.validateDictionary(p.attributes).length === 0);
    check(`分野パック ${p.planType}: すべての属性が自分の分野だけを持つ`,
      p.attributes.every((d) => (d.planTypes ?? []).length === 1 && d.planTypes[0] === p.planType));
  }
  check("分野パックのキーがコアと重複しない", packs.every((p) => p.attributes.every((d) => !core.some((c) => c.key === d.key))));
  check("packFor は計画種別で選び、未知なら何も返さない",
    m.packFor(packs[0].planType)?.planType === packs[0].planType && m.packFor("no_such_plan") === undefined && m.packFor(null) === undefined);
  check("自由記述型が無い（コア・分野パックとも）", [...core, ...m.allDomainAttributes()].every((d) => d.valueType !== "text"));
  check("準識別子はすべて粗化のはしごを持つ",
    [...core, ...m.allDomainAttributes()].filter((d) => d.role === "quasi_identifier").every((d) => d.generalization));
  check("値の語彙が自治体ごとに違う属性は localCodes を立て、未登録では使えない",
    core.some((d) => d.key === "demo.area" && d.localCodes === true) && !m.isUsable(core.find((d) => d.key === "demo.area")));
  check("庁内限定の属性（cloudAllowed=false）がある", core.some((d) => d.cloudAllowed === false));
  check("辞書の重ね合わせはあとの層が前を上書きする",
    m.mergeDictionaries([{ key: "x.y", label: "A", description: "", valueType: "bool", role: "neutral", timeGranularity: "static", cloudAllowed: true }],
      [{ key: "x.y", label: "B" }])[0].label === "B");
  check("重ね合わせは部分上書きができる（値の語彙だけ足す）", (() => {
    const merged = m.mergeDictionaries(
      [{ key: "demo.area", label: "地区", description: "", valueType: "code", codes: {}, localCodes: true, role: "neutral", timeGranularity: "static", cloudAllowed: true }],
      [{ key: "demo.area", codes: { a1: "中央" } }]);
    return merged[0].label === "地区" && merged[0].codes.a1 === "中央" && m.isUsable(merged[0]);
  })());
  check("構造検査は自由記述型を弾く",
    m.validateDictionary([{ key: "x.y", label: "", description: "", valueType: "text", role: "neutral", timeGranularity: "static", cloudAllowed: true }]).length > 0);
  check("構造検査は codes 無しの区分型を弾く（localCodes なら許す）",
    m.validateDictionary([{ key: "x.y", label: "a", description: "", valueType: "code", role: "neutral", timeGranularity: "static", cloudAllowed: true }]).length > 0 &&
    m.validateDictionary([{ key: "x.y", label: "a", description: "", valueType: "code", codes: {}, localCodes: true, role: "neutral", timeGranularity: "static", cloudAllowed: true }]).length === 0);
  check("構造検査ははしごの写像漏れを弾く",
    m.validateDictionary([{ key: "x.y", label: "a", description: "", valueType: "code", codes: { a: "A", b: "B" }, role: "quasi_identifier",
      generalization: { priority: 1, levels: [{ label: "l", map: { a: "*" } }] }, timeGranularity: "static", cloudAllowed: true }]).length > 0);

  // ── 5. 粗化と k-匿名性 ───────────────────────────
  console.log("5. 粗化と k-匿名性");
  check("年齢 → 5歳階級", m.ageToBand5(67) === "65-69" && m.ageToBand5(19) === "u20" && m.ageToBand5(101) === "100+" && m.ageToBand5(-1) === null);
  const age = core.find((d) => d.key === "demo.age_band5");
  check("はしごを上げると粗くなる", m.generalizeCode(age, "65-69", 1) === "60-69" && m.generalizeCode(age, "65-69", 2) === "60-79");
  check("段数を超えると削除（*）", m.generalizeCode(age, "65-69", 9) === "*");
  check("写像に無いコードは null", m.generalizeCode(age, "bogus", 1) === null);
  const area = { ...core.find((d) => d.key === "demo.area"), codes: { a1: "中央", a2: "東部" } };
  check("値の語彙が自治体ごとの属性は collapseTo で1段にまとめる", m.generalizeCode(area, "a1", 1) === "*");

  const dict = [...core, ...m.allDomainAttributes()];
  const rows = [];
  let n = 0;
  const mk = (areaCode, sex, band, count, sens) => {
    for (let i = 0; i < count; i++) {
      rows.push({ sid: "S" + String(n++).padStart(20, "0"),
        values: { "demo.area": areaCode, "demo.sex": sex, "demo.age_band5": band, "econ.income_band": sens[i % sens.length] } });
    }
  };
  mk("a1", "M", "70-74", 12, ["low", "mid"]);
  mk("a1", "F", "70-74", 12, ["low", "mid"]);
  mk("a2", "M", "75-79", 12, ["mid", "high"]);
  mk("a2", "F", "75-79", 12, ["low"]);
  mk("a2", "F", "85-89", 3, ["low", "mid"]);
  const dictWithArea = dict.map((d) => (d.key === "demo.area" ? area : d));
  const r = m.enforceAnonymity(rows, dictWithArea, { k: 10, l: 2 });
  check("結果は k を満たす", r.ok && r.kObserved >= 10);
  check("満たせない行は抑制され、件数が返る", r.suppressed > 0 && r.rows.length + r.suppressed === rows.length);
  check("地区（priority 1）が先に粗くなる", (r.levels["demo.area"] ?? 0) >= 1);
  const rowsL = rows.slice(-27, -3);
  const rL = m.enforceAnonymity(rowsL, dictWithArea, { k: 10, l: 2 });
  check("機微属性が1値に偏るセルではその属性が * になる（k は満たしても）",
    rL.suppressed === 0 && rL.sensitiveDropped["econ.income_band"] === 12 &&
    rL.rows.filter((x) => x.values["econ.income_band"] === "*").length === 12);
  const big = [];
  for (let i = 0; i < 40; i++) big.push({ sid: "S" + String(i).padStart(20, "0"), values: { "demo.sex": i % 2 ? "M" : "F" } });
  const r2 = m.enforceAnonymity(big, dict, { k: 10, l: 2 });
  check("十分大きいセルは粗化も抑制もされない", r2.suppressed === 0 && r2.levels["demo.sex"] === 0 && r2.rows.length === 40);
  check("空入力でも落ちない", m.enforceAnonymity([], dict, { k: 10, l: 2 }).ok);

  // ── 6. 五つ組への展開 ────────────────────────────
  console.log("6. 五つ組への展開");
  const sex = core.find((d) => d.key === "demo.sex");
  const monthAttr = dict.find((d) => d.timeGranularity === "month");
  check("時点の丸め: month → 月初 / fiscal_year → 年度開始日 / static → 1900-01-01",
    m.observedAtFor(monthAttr, "2026-09-14") === "2026-09-01" &&
    m.observedAtFor(age, "2026-03-31") === "2025-04-01" &&
    m.observedAtFor(sex, "2026-09-14") === "1900-01-01");
  const w = m.wideToObservations(
    [
      { sid: a.sid, values: { "demo.sex": "M", "econ.income_band": "low", "prog.participated": "有", "outcome.cost_amount": "1,234" } },
      { sid: a.sid.slice(0, 5), values: { "demo.sex": "M" } },
      { sid: m.deriveSid(K1, P1, "atena", R, "2").sid, values: { "demo.sex": "Q", "id.address_code": "x", "free.text": "a", "outcome.cost_amount": valid } },
    ],
    dict, "2026-09-14",
  );
  check("正しい行は展開される（4 属性 → 4 観測）", w.observations.filter((o) => o.sid === a.sid).length === 4 && w.accepted === 1);
  check("値は型に応じて1列だけ",
    w.observations.every((o) => ["valueCode", "valueNum", "valueBool"].filter((k) => o[k] !== undefined).length === 1));
  check("bool の日本語表記を吸収", w.observations.find((o) => o.attrKey === "prog.participated")?.valueBool === true);
  check("カンマ付き数値を吸収", w.observations.find((o) => o.attrKey === "outcome.cost_amount" && o.sid === a.sid)?.valueNum === 1234);
  const reasons = Object.fromEntries(w.rejects.map((x) => [x.reason + ":" + (x.attrKey ?? ""), x.count]));
  check("sid が不正な行は拒否", reasons["missing_sid:"] === 1);
  check("不正なコードは拒否", reasons["invalid_code:demo.sex"] === 1);
  check("庁内限定の属性は拒否", reasons["not_cloud_allowed:id.address_code"] === 1);
  check("辞書に無い属性は拒否", reasons["unknown_attr:free.text"] === 1);
  check("個人番号様の値は拒否", reasons["looks_like_my_number:outcome.cost_amount"] === 1);
  check("拒否の記録に値そのものが無い", !JSON.stringify(w.rejects).includes(valid));

  // ── 7. 集計データの列定義 ────────────────────────
  console.log("7. 集計データの列定義");
  const mig066 = read(join(REPO_ROOT, "infra", "migrations", "066_datasets_individual.sql"));
  const schemas = [...mig066.matchAll(/SET column_schema = '(\[[\s\S]*?\])'::jsonb/g)].map((x) => JSON.parse(x[1]));
  check("集計テンプレートに列定義がある", schemas.length >= 12);
  check("すべての列定義が構造検査を通る", schemas.every((s) => m.validateColumnSchema(s).length === 0));
  const cir = schemas.find((s) => s.some((c) => c.role === "time") && s.filter((c) => c.role === "measure").length >= 3);
  const v = m.validateAggregateRows(
    [{ name: "年度", role: "time", type: "fiscal_year" }, { name: "件数", role: "measure", type: "int" }, { name: "割合", role: "measure", type: "numeric" }],
    [
      { 年度: "令和8年度", 件数: "5,100", 割合: "20.0%" },
      { 年度: "2026", 件数: "x", 割合: "1" },
    ], "2026-04-01");
  check("和暦の年度を正規化し、数値のカンマ・％を吸収する",
    v.rows.length === 1 && v.rows[0].period === "2026-04-01" && v.rows[0].measures["件数"] === 5100 && v.rows[0].measures["割合"] === 20);
  check("数値でない measure は行ごと拒否し、位置だけ返す", v.errors.length === 1 && v.errors[0].row === 2 && v.errors[0].column === "件数");
  check("列定義の構造検査は measure 無しを弾く", m.validateColumnSchema([{ name: "a", role: "dimension", type: "text" }]).length > 0);
  check("cir（3 measure 以上のテンプレート）が存在する", !!cir);

  // ── 8. マイグレーション 066 の構造 ───────────────
  console.log("8. マイグレーション 066");
  check("冪等（IF NOT EXISTS）", !/CREATE TABLE (?!IF NOT EXISTS)/.test(mig066) && !/ADD COLUMN (?!IF NOT EXISTS)/.test(mig066));
  for (const t of ["attribute_definitions", "datasets", "dataset_versions", "dataset_rows", "subjects", "sid_aliases",
    "observations", "cohorts", "cohort_members", "experiment_assignments", "release_requests", "activity_log"]) {
    check(`066 が ${t} を作る`, new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`).test(mig066));
  }
  const obsDef = mig066.slice(mig066.indexOf("CREATE TABLE IF NOT EXISTS observations ("), mig066.indexOf("CREATE INDEX IF NOT EXISTS idx_observations_attr"));
  check("observations に個人を特定しうる列が無い",
    !/\b(name|kana|address|birth|phone|tel|email|my_number)\b/i.test(obsDef.replace(/--[^\n]*/g, "")));
  check("observations に自由記述列が無い（TEXT は sid と attr_key と value_code だけ）",
    (obsDef.replace(/--[^\n]*/g, "").match(/\bTEXT\b/g) ?? []).length === 3);
  check("observations の値は1列だけ（CHECK num_nonnulls）", /num_nonnulls\(value_code, value_num, value_bool\) = 1/.test(obsDef));
  check("属性辞書に 'text' 型が無い", /value_type IN \('code','band','int','numeric','bool','month','fiscal_year'\)/.test(mig066));
  check("属性辞書の cloud_allowed の既定は false", /cloud_allowed\s+BOOLEAN NOT NULL DEFAULT false/.test(mig066));
  check("準識別子はしご必須の CHECK がある", /role <> 'quasi_identifier' OR generalization IS NOT NULL/.test(mig066));
  check("鍵そのものの列が無い（key_id のみ）", /key_id\s+TEXT/.test(mig066) && !/\bkey_bytes\b|\bsecret\b|\bhmac_key\b/i.test(mig066));
  check("activity_log の via の語彙が閉じている",
    /via\s+TEXT NOT NULL CHECK \(via IN \('ui','bulk','gap_analysis','dialogue','evaluation','auto_tasks','migration'\)\)/.test(mig066));

  // ── 9. マイグレーション 068（辞書の汎用化） ──────
  console.log("9. マイグレーション 068（辞書の汎用化）");
  const mig068 = read(join(REPO_ROOT, "infra", "migrations", "068_generic_dictionary.sql"));
  check("068 が存在する", mig068.length > 0);
  check("attribute_keys（キーの登録簿）を作り、observations の外部キー先にする",
    /CREATE TABLE IF NOT EXISTS attribute_keys \(/.test(mig068) &&
    /REFERENCES attribute_keys\(key\)/.test(mig068));
  check("attribute_definitions は (key, municipality_id) で一意（自治体ごとの上書きを許す）",
    /UNIQUE NULLS NOT DISTINCT \(key, municipality_id\)/.test(mig068));
  check("key_type_definitions を作る（キー種別はコードに列挙しない）",
    /CREATE TABLE IF NOT EXISTS key_type_definitions \(/.test(mig068));
  check("共通のキー種別は宛名番号1件だけ",
    (mig068.match(/INSERT INTO key_type_definitions/g) ?? []).length === 1 && /'atena', NULL/.test(mig068));
  check("**計画種別の既定が分野中立（custom）になっている**",
    /ALTER TABLE projects ALTER COLUMN plan_type SET DEFAULT 'custom'/.test(mig068));
  check("コア辞書のキーがすべて 068 に投入されている", core.every((d) => mig068.includes(`(${JSON.stringify(d.key).replace(/"/g, "'")},`)));
  check("分野パックの属性がすべて 068 に投入されている", m.allDomainAttributes().every((d) => mig068.includes(`(${JSON.stringify(d.key).replace(/"/g, "'")},`)));
  check("投入はコアを plan_types 空で、分野パックをその分野で入れている",
    core.every((d) => new RegExp(`'${d.key.replace(".", "\\.")}'[\\s\\S]{0,2000}?ARRAY\\[\\]::text\\[\\]`).test(mig068)));
  for (const p of packs) {
    check(`068 が分野 ${p.planType} を配列で指定している`, mig068.includes(`ARRAY['${p.planType}']::text[]`));
  }
  check("共通行だけを更新する（テナント拡張を壊さない）", /municipality_id IS NULL/.test(mig068));
  check("掃除は observations から参照されている行を残す",
    /DELETE FROM attribute_definitions[\s\S]*?NOT EXISTS \(SELECT 1 FROM observations/.test(mig068));

  // ── 10. サービス層と API ─────────────────────────
  console.log("10. サービス層と API");
  const svc = read(join(APP_ROOT, "src", "lib", "dataset", "service.ts"));
  const apiDir = join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "datasets");
  const routes = [
    "route.ts",
    "[datasetId]/route.ts",
    "[datasetId]/versions/route.ts",
    "[datasetId]/versions/[versionId]/route.ts",
    "[datasetId]/versions/[versionId]/download/route.ts",
    "dictionary/route.ts",
    "key-types/route.ts",
  ].map((r) => [r, read(join(apiDir, r))]);
  for (const [r, src] of routes) {
    check(`API ${r} が存在する`, src.length > 0);
    check(`API ${r} がテナント境界を通す`, /requireProjectAccess\(session, params\.id\)/.test(src));
    check(`API ${r} がモジュール権限を見る`, /requireModulePermission\(session, params\.id, "dataset_manager"/.test(src));
    check(`API ${r} は SQL を直接書かずサービス層を呼ぶ`, !/INSERT INTO|UPDATE |DELETE FROM/.test(src) && /@\/lib\/dataset\//.test(src));
    check(`API ${r} は route 以外を export しない`, !/export function datasetErrorResponse/.test(src));
  }
  check("サービス層の書き込みはすべて activity_log に残す", (svc.match(/await logActivity\(/g) ?? []).length >= 7);
  check("サービス層は Actor（via・担当者）を必ず受け取る", /export interface Actor/.test(svc) && /actor: Actor/.test(svc));
  check("AI 経路でも actor はその対話の担当者（AI 自身を actor にする列が無い）", !/actor_is_ai|ai_actor/.test(svc));
  check("集計データの版は1行でも失敗したら版全体を rejected にする", /版全体を rejected/.test(svc) && /rejected \? "rejected" : "validated"/.test(svc));
  check("個人番号様の値がある場合はファイルを保存しない", /guardHits\.length === 0\) \{\s*await uploadToStorage/.test(svc));
  check("個票の箱への CSV 取込は 501", /501,\s*\)/.test(svc));
  check("**辞書は DB から解決する**（コード上の定数と突き合わせない）",
    /export async function resolveDictionary/.test(svc) &&
    /await resolveDictionary\(projectId, actor\.municipalityId\)/.test(svc) &&
    !/CARE_INSURANCE_DICTIONARY/.test(svc));
  check("辞書の解決が計画種別と自治体で絞っている",
    /cardinality\(a\.plan_types\) = 0/.test(svc) && /a\.municipality_id IS NULL OR a\.municipality_id = \$2/.test(svc));
  check("テナント拡張を登録できる", /export async function upsertTenantAttribute/.test(svc));
  check("キー種別を登録できる（コードは変えられない旨の拒否がある）",
    /export async function createKeyType/.test(svc) && /既に使われています/.test(svc));
  const stale = execFileSync("grep", ["-rl", "project_datasets", join(APP_ROOT, "src"), "--include=*.ts", "--include=*.tsx"], { encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !f.includes("/content/manual/"))
    .filter((f) => /FROM project_datasets|INTO project_datasets|UPDATE project_datasets/.test(read(f)));
  check("src に project_datasets を読む SQL が残っていない", stale.length === 0);
  const mig067 = read(join(REPO_ROOT, "infra", "migrations", "067_drop_project_datasets.sql"));
  check("067 が project_datasets を落とす（移行漏れがあれば止まる）",
    /DROP TABLE project_datasets/.test(mig067) && /RAISE EXCEPTION/.test(mig067) && /legacy:/.test(mig067));
  const csv = read(join(APP_ROOT, "src", "lib", "dataset", "csv.ts"));
  check("CSV は UTF-8 で読めなければ Shift_JIS", /fatal: true/.test(csv) && /shift_jis/.test(csv));
  check("check:datasetsvc（実 DB 検査）が存在する", existsSync(join(APP_ROOT, "scripts", "check-dataset-service.mjs")));

  // ── 11. 画面が分野を決め打ちしていないこと ────────
  console.log("11. 画面");
  const pageSrc = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "datasets", "page.tsx"));
  const clientSrc = read(join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "datasets", "DatasetsClient.tsx"));
  check("画面は辞書を resolveDictionary から取る（定数を import しない）",
    /resolveDictionary/.test(pageSrc) && !/CORE_DICTIONARY|CARE_INSURANCE/.test(pageSrc) && !/CORE_DICTIONARY|CARE_INSURANCE/.test(clientSrc));
  check("画面は分野パックの有無を示し、無くても使えることを書いている",
    /packFor/.test(pageSrc) && /分野が設定されていない/.test(clientSrc));
  check("自団体の属性とキー種別を登録する導線がある",
    /自団体の属性を登録/.test(clientSrc) && /キー種別を登録/.test(clientSrc));
  check("値の区分が未登録の属性は選べないことを示す", /値の区分が未登録/.test(clientSrc));

  // ── 12. マニュアル ───────────────────────────────
  console.log("12. マニュアル");
  const manual = read(join(APP_ROOT, "src", "content", "manual", "datasets.md"));
  check("datasets.md が箱と版・個票・鍵方式を説明している",
    /箱/.test(manual) && /版/.test(manual) && /個票/.test(manual) && /鍵/.test(manual) && /対応表/.test(manual));
  check("datasets.md の frontmatter に 066/068 と新テーブルがある",
    /066/.test(manual) && /068/.test(manual) && /observations/.test(manual) && /attribute_definitions/.test(manual));
  check("datasets.md が辞書の3層を説明している", /分野パック/.test(manual) && /テナント拡張|自団体/.test(manual));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck:dataset — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
