#!/usr/bin/env node
/**
 * 施策の指標体系（17カテゴリ）と評価タイミングの検査
 *
 * この検査を作った理由:
 *   ①別紙「プログラム評価指標一覧」の17カテゴリを網羅することが要件。
 *     カテゴリが欠けたり番号がずれたりすると、C評価・A改善の改修が噛み合わなくなる。
 *   ②**評価フローが止まる指標だけを必須**にし、残りは未設定でも次へ進めることが要件。
 *     必須を増やすと担当者が埋められず工程が止まり、減らすと評価が回らない。
 *     どちらへ倒れても気づけるよう、必須6件・推奨4件・任意7件を固定する。
 *   ③評価タイミングは介護保険事業計画に固有の「2、3年目の上旬」ではなく、
 *     あらゆる行政計画で使える形（頻度＋相対年次／絶対日付）で持つこと。
 *     実装に年次を直書きしていないことを確かめる。
 *   ④二層化（主要施策＝図7、取組＝図6）に対応するテーブルが 057 にあること。
 *
 * 使い方:
 *   node scripts/check-measure-indicators.mjs
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

// ── 1. マイグレーション 057 ─────────────────────
const mig = join(REPO_ROOT, "infra", "migrations", "057_measure_works_indicators.sql");
check("057_measure_works_indicators.sql が存在する", existsSync(mig));
if (existsSync(mig)) {
  const sql = read(mig);
  for (const t of [
    "measure_works",
    "measure_activities",
    "measure_activity_tasks",
    "measure_indicators",
    "measure_indicator_checkpoints",
    "measure_cost_years",
    "measure_cost_items",
  ]) {
    check(`057 が ${t} を作る`, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`).test(sql));
  }
  check("057 は冪等（IF NOT EXISTS）", !/CREATE TABLE (?!IF NOT EXISTS)/.test(sql));
  check("057: 取組も行を消さず取り下げる", /measure_works[\s\S]*?retired\s+BOOLEAN/.test(sql));
  check(
    "057: 指標は取組にも主要施策にも付けられる",
    /measure_work_id\s+UUID\s+REFERENCES measure_works\(id\)/.test(sql),
  );
  check("057: カテゴリ番号は1〜17に限る", /category_no BETWEEN 1 AND 17/.test(sql));
  check("057: 評価時点は相対年次と絶対日付の両方を持つ", /relative_year/.test(sql) && /absolute_date/.test(sql));
  check("057: 年度別コストは年度で一意", /UNIQUE \(measure_design_id, fiscal_year\)/.test(sql));
  check("057: 財源内訳を持つ", /funding\s+JSONB/.test(sql));
  check("057: アクティビティに実施期限がある", /due_date\s+DATE/.test(sql));
  check("057: アクティビティに繰り返しがある", /recurrence\s+TEXT/.test(sql));
  check("057: 成果物の要否と提出期限がある", /document_required/.test(sql) && /document_deadline/.test(sql));
  check("057: スケジュールタスクとの対応表がある", /schedule_task_id\s+UUID\s+NOT NULL REFERENCES schedule_tasks/.test(sql));
}

// ── 2. 実装に計画年次を直書きしていない ───────────────
const src = read(join(APP_ROOT, "src", "lib", "measure", "indicators.ts"));
check("indicators.ts が存在する", src.length > 0);
check(
  "評価タイミングに介護保険固有の年次を直書きしていない",
  !src.includes("2、3年目") && !src.includes("3年目の上旬"),
);
check("頻度に計画期間ごとがある", src.includes('plan_period'));
check("相対年次で持てる", src.includes("relativeYearOf"));
check("和暦の年度表記がある", src.includes("fiscalYearLabel"));

// ── 3. カタログの中身 ──────────────────────────
const work = mkdtempSync(join(tmpdir(), "measure-indicators-"));
const outFile = join(work, "indicators.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install", "esbuild",
      join(APP_ROOT, "src", "lib", "measure", "indicators.ts"),
      "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);
  const cats = m.INDICATOR_CATEGORIES;

  check("17カテゴリある", cats.length === 17);
  check("番号が1〜17で欠けなく並ぶ", cats.map((c) => c.no).join() === Array.from({ length: 17 }, (_, i) => i + 1).join());
  check("すべてに定義がある", cats.every((c) => c.definition.trim().length > 0));
  check("すべてに扱いの根拠がある", cats.every((c) => c.reason.trim().length > 0));
  check("すべてにデータソースの例がある", cats.every((c) => c.sourceHint.trim().length > 0));

  // 別紙の区分 A〜F
  check("区分がA〜Fで揃う", new Set(cats.map((c) => c.group)).size === 6);

  // 必須・推奨・任意の内訳（評価フローから導いた割り当て）
  const req = cats.filter((c) => c.requirement === "required").map((c) => c.no);
  const rec = cats.filter((c) => c.requirement === "recommended").map((c) => c.no);
  const opt = cats.filter((c) => c.requirement === "optional").map((c) => c.no);
  check("必須は6件（3・5・6・7・8・15）", req.join() === "3,5,6,7,8,15");
  check("推奨は4件（4・10・11・13）", rec.join() === "4,10,11,13");
  check("任意は7件", opt.length === 7);
  check("必須と推奨と任意で17件を尽くす", req.length + rec.length + opt.length === 17);

  // 層の割り当て — 図6は取組、図7は主要施策
  check(
    "取組レベルの必須は 5・6・7（図6 工程1〜3）",
    m.requiredCategoryNos("work").join() === "5,6,7",
  );
  check(
    "主要施策レベルの必須は 3・8・15（図7と工程6）",
    m.requiredCategoryNos("measure").join() === "3,8,15",
  );
  check("ストラクチャーは取組レベル（工程0は取組ごと）", m.INDICATOR_BY_NO[4].level === "work");
  check("カバレッジと忠実度は取組レベル（工程2b）", m.INDICATOR_BY_NO[10].level === "work" && m.INDICATOR_BY_NO[11].level === "work");
  check("中間アウトカムは主要施策レベル（図7 工程1）", m.INDICATOR_BY_NO[8].level === "measure");

  // 評価類型の対応（別紙マトリクスの◎）
  check("アクティビティはプロセス評価", m.INDICATOR_BY_NO[5].primary.includes("process"));
  check("中間アウトカムはアウトカム評価", m.INDICATOR_BY_NO[8].primary.includes("outcome"));
  check("インパクトはインパクト評価", m.INDICATOR_BY_NO[13].primary.includes("impact"));
  check("単位コストはコスト・効率性評価", m.INDICATOR_BY_NO[15].primary.includes("cost"));

  // 目標が定まっているかの判定
  check("目標: 数値目標があれば設定済み", m.indicatorHasTarget({ category_no: 5, label: "開催回数", target_value: 12 }) === true);
  check("目標: 有無で測る指標は単位があれば設定済み", m.indicatorHasTarget({ category_no: 4, label: "要綱の整備", unit: "有無" }) === true);
  check("目標: 名前が無ければ未設定", m.indicatorHasTarget({ category_no: 5, label: "  ", target_value: 1 }) === false);
  check("目標: 数値も単位も無ければ未設定", m.indicatorHasTarget({ category_no: 5, label: "開催回数" }) === false);

  // 不足の検出
  const works = [{ id: "w1", title: "仕様書への明記" }, { id: "w2", title: "様式の改訂" }];
  const full = [
    ...[3, 8, 15].map((no) => ({ category_no: no, label: `m${no}`, target_value: 1 })),
    ...works.flatMap((w) =>
      [5, 6, 7].map((no) => ({ category_no: no, measure_work_id: w.id, label: `w${no}`, target_value: 1 })),
    ),
  ];
  check("不足: 全部そろえば無し", m.indicatorGaps(works, full, "施策").length === 0);

  const missingOne = full.filter((i) => !(i.measure_work_id === "w2" && i.category_no === 7));
  const g = m.indicatorGaps(works, missingOne, "施策");
  check("不足: 取組ごとに名指しで返す", g.length === 1 && g[0].work_id === "w2");
  check("不足: 欠けたカテゴリを番号と名前で返す", g[0].missing[0].no === 7 && g[0].missing[0].name === "初期アウトカム指標");
  // 行はあるのに目標だけ無い場合と、そもそも作っていない場合を区別する
  check("不足: そもそも無ければ「未作成」", g[0].missing[0].reason === "未作成");
  const noTarget = full.map((i) =>
    i.measure_work_id === "w2" && i.category_no === 7 ? { ...i, target_value: null, unit: null } : i,
  );
  const g2 = m.indicatorGaps(works, noTarget, "施策");
  check("不足: 行はあるが目標が無ければ「目標値が未設定」", g2[0].missing[0].reason === "目標値が未設定");
  check(
    "不足: 説明文は取組名と理由を出す",
    m.describeIndicatorGaps(g).startsWith("様式の改訂: 7 初期アウトカム指標（未作成）"),
  );
  check(
    "不足: 取り下げた取組は要求しない",
    m.indicatorGaps([...works, { id: "w3", title: "取り下げ", retired: true }], full, "施策").length === 0,
  );
  const noMeasure = full.filter((i) => i.measure_work_id);
  check(
    "不足: 主要施策レベルの欠けも返す",
    m.indicatorGaps(works, noMeasure, "施策").some((x) => x.work_id === null && x.missing.length === 3),
  );

  // 任意指標は不足に数えない
  check(
    "不足: 任意（ニーズ・公平性等）は要求しない",
    !m.indicatorGaps(works, full, "施策").some((x) => x.missing.some((mm) => [1, 2, 9, 12, 14, 16, 17].includes(mm.no))),
  );
  // 推奨も止めない
  check(
    "不足: 推奨（工程0・2b）でも止めない",
    m.indicatorGaps(works, full, "施策").length === 0,
  );

  // 年度と財源
  check("年度: 2026は令和8年度", m.fiscalYearLabel(2026) === "令和8年度");
  check("年度: 2019は令和1年度", m.fiscalYearLabel(2019) === "令和1年度");
  check("年度: 令和より前は西暦のまま", m.fiscalYearLabel(2015) === "2015年度");
  check("年度: 計画開始からの相対年次", m.relativeYearOf(2026, 2028) === 3);
  check("財源: 区分は5つ", m.FUNDING_SOURCES.length === 5);
  check("財源: 合計を出す", m.fundingTotal({ national: 100, general: 50 }) === 150);
  check(
    "財源: 事業費計と食い違う年度を返す",
    m.fundingMismatchYears([
      { fiscal_year: 2026, total_amount: 370000, funding: { special_account: 350000, general: 20000 } },
      { fiscal_year: 2027, total_amount: 20000, funding: { general: 10000 } },
    ]).join() === "2027",
  );
  check(
    "財源: 未入力の年度（0対0）は食い違いにしない",
    m.fundingMismatchYears([{ fiscal_year: 2028 }]).length === 0,
  );

  // 頻度の語彙
  check("頻度: 計画期間ごとが選べる", m.FREQUENCY_LABEL.plan_period === "計画期間ごと");
  check("頻度: 7種類", Object.keys(m.FREQUENCY_LABEL).length === 7);
  check("評価時点: 上期・下期・年度末", Object.keys(m.RELATIVE_PERIOD_LABEL).join() === "first,second,end");
  check("評価類型: 6種類", Object.keys(m.EVALUATION_KIND_LABEL).length === 6);
} catch (e) {
  check(`indicators.ts のバンドル/実行: ${e instanceof Error ? e.message : e}`, false);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── 4. データセットAPIと自動補完 ─────────────────
{
  const ds = read(join(APP_ROOT, "src", "lib", "measure", "dataset.ts"));
  const route = read(
    join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]",
      "measure-design", "[measureId]", "dataset", "route.ts"),
  );
  check("dataset.ts がある", ds.length > 0);
  check("dataset: 取組も行を消さず取り下げる", ds.includes("export function activeWorks"));
  check("dataset: 取組コードは番号を再利用しない", ds.includes("export function nextWorkCode"));
  check("dataset: 自動補完がある", ds.includes("export function buildAutoFill"));
  check("dataset: 何を自動で入れたか残す", ds.includes("auto_filled: true"));
  check("dataset: 期限未設定のアクティビティを拾う", ds.includes("activitiesWithoutDue"));
  check("dataset: 財源の食い違いを拾う", ds.includes("fundingMismatch"));

  check("API: データセットのルートがある", route.length > 0);
  check("API: 一式を返す（画面は1本で描ける）", /export async function GET/.test(route));
  check("API: 下書きの生成", /action !== "seed"/.test(route));
  check(
    "API: 下書きは最初の1回だけ（既存を上書きしない）",
    route.includes("すでに取組が登録されています"),
  );
  check("API: どの項目も後から編集できる", /export async function PATCH/.test(route));
  check(
    "API: 送られてこなかった取組は取り下げ扱い（行は消さない）",
    /UPDATE measure_works SET retired = true/.test(route),
  );
  check("API: 手で直したら自動の印を外す", /auto_filled=false/.test(route));
  check("API: 権限を確かめる", route.includes('requireModulePermission(session, params.id, "measure_design"'));
  check("API: 年度は4月始まりで数える", route.includes("getUTCMonth() + 1 >= 4"));
}

// ── 5. スケジュールへの反映 ─────────────────────
{
  const sch = read(join(APP_ROOT, "src", "lib", "measure", "schedule.ts"));
  const route = read(
    join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]",
      "measure-design", "[measureId]", "dataset", "schedule", "route.ts"),
  );
  check("schedule.ts がある", sch.length > 0);
  check("反映: 期限が無ければ反映しない", sch.includes("if (!a.due_date) return [];"));
  check("反映: 繰り返しを回数分に展開する", sch.includes("export function planTasks"));
  check("反映: 反映できなかったものを返す", sch.includes("skipped"));
  check("API: 押す前に下見できる", /export async function GET/.test(route));
  check("API: 反映を実行する", /export async function POST/.test(route));
  check(
    "API: 完了済みのタスクは消さない（実績が消えると指標No.5の分子が失われる）",
    route.includes("completed_at == null"),
  );
  check("API: 施策IDを付けて登録する（進捗ボードとICSに載る）", route.includes("measure_design_id"));
  check("API: 対応表に記録する", route.includes("INSERT INTO measure_activity_tasks"));

  // 純粋ロジックの実挙動
  const w2 = mkdtempSync(join(tmpdir(), "measure-schedule-"));
  const out2 = join(w2, "schedule.mjs");
  try {
    execFileSync(
      "npx",
      [
        "--no-install", "esbuild",
        join(APP_ROOT, "src", "lib", "measure", "schedule.ts"),
        "--bundle", "--format=esm", "--target=es2020", "--platform=neutral",
        `--alias:@=${join(APP_ROOT, "src")}`,
        `--outfile=${out2}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
    );
    const s2 = await import(pathToFileURL(out2).href);
    const act = (over = {}) => ({
      id: "a1", measure_work_id: "w1", title: "協議会での審議", note: null,
      start_date: null, due_date: "2026-11-30", recurrence: "none", occurrences: null,
      owner_department: "介護保険係", document_required: false, document_deadline: null,
      document_offset_days: null, sort_order: 0, task_count: 0, ...over,
    });

    check("展開: 期限が無ければ0件", s2.planTasks(act({ due_date: null }), 3).length === 0);
    check("展開: 繰り返し無しは1件", s2.planTasks(act(), 3).length === 1);
    check("展開: 1件のときは回数を付けない", s2.planTasks(act(), 3)[0].title === "協議会での審議");

    const yearly = s2.planTasks(act({ recurrence: "annual", occurrences: 4 }), 3);
    check("展開: 毎年度×4回で4件", yearly.length === 4);
    check("展開: 1年ずつ後ろへずらす", yearly.map((t) => t.due_date).join() ===
      "2026-11-30,2027-11-30,2028-11-30,2029-11-30");
    check("展開: 繰り返しは回数を添える", yearly[1].title === "協議会での審議（2回目）");

    check("展開: 回数未指定なら計画年度数から決める",
      s2.planTasks(act({ recurrence: "annual" }), 3).length === 3);
    check("展開: 四半期なら年4回", s2.defaultOccurrences("quarterly", 2) === 8);
    check("展開: 月次なら年12回", s2.defaultOccurrences("monthly", 1) === 12);

    const doc = s2.planTasks(
      act({ recurrence: "annual", occurrences: 2, document_required: true, document_offset_days: 30 }), 3);
    check("成果物: 相対指定は各回の期限から数える",
      doc[0].document_deadline === "2026-12-30" && doc[1].document_deadline === "2027-12-30");
    const docAbs = s2.planTasks(act({ document_required: true, document_deadline: "2026-12-15" }), 3);
    check("成果物: 単発は絶対日付をそのまま使う", docAbs[0].document_deadline === "2026-12-15");
    check("成果物: 不要なら期限を付けない", s2.planTasks(act(), 3)[0].document_deadline === null);

    check("日付: 月末は丸める（1/31＋1か月＝2/28）", s2.addMonths("2026-01-31", 1) === "2026-02-28");
    check("日付: 年をまたぐ", s2.addMonths("2026-11-30", 12) === "2027-11-30");
    check("日付: 日数を足す", s2.addDays("2026-12-31", 1) === "2027-01-01");

    const pl = s2.planSchedule([act(), act({ id: "a2", title: "期限なし", due_date: null })], 3);
    check("一括: 反映できるものとできないものを分ける",
      pl.tasks.length === 1 && pl.skipped.length === 1 && pl.skipped[0].title === "期限なし");
    check("展開: 回数の上限がある（暴走防止）",
      s2.planTasks(act({ recurrence: "monthly", occurrences: 500 }), 3).length === 60);
  } catch (e) {
    check(`schedule.ts のバンドル/実行: ${e instanceof Error ? e.message : e}`, false);
  } finally {
    rmSync(w2, { recursive: true, force: true });
  }
}

// ── 6. 画面 ────────────────────────────────
{
  const panel = read(join(APP_ROOT, "src", "components", "measure", "MeasureDatasetPanel.tsx"));
  const client = read(
    join(APP_ROOT, "src", "app", "(admin)", "projects", "[id]", "measure-design", "MeasureDesignClient.tsx"),
  );
  check("画面: データセットのパネルがある", panel.length > 0);
  check("画面: 施策構築の画面に組み込まれている", client.includes("<MeasureDatasetPanel"));
  check("画面: 確定済みの施策は編集させない", client.includes('canEdit={m.status !== "confirmed"}'));

  check("画面: 取組を編集できる", panel.includes("＋ 取組を追加"));
  check("画面: 取組は取り下げ（行は消さない）", panel.includes("行は消さず、取り下げとして残します"));
  check("画面: 実施項目を編集できる", panel.includes("＋ 実施項目を追加"));
  check("画面: 繰り返しを選べる", panel.includes("RECURRENCE_LABEL"));
  check("画面: 期限未設定を知らせる", panel.includes("期限未設定"));
  check("画面: スケジュールに反映できる", panel.includes("スケジュールに反映"));
  check("画面: 反映しなかった項目を伝える", panel.includes("期限未設定で反映しなかった項目"));
  check("画面: 完了済みを残したことを伝える", panel.includes("完了済み"));

  check("画面: 17カテゴリから指標を足せる", panel.includes("INDICATOR_CATEGORIES.filter"));
  check("画面: 必須・推奨・任意を出し分ける", panel.includes("REQUIREMENT_LABEL[r.requirement]"));
  check("画面: 自動で入れた値に印を付ける", panel.includes('<Chip kind="auto">自動</Chip>'));
  check("画面: 手で直したら自動の印を外す", panel.includes("auto_filled: false"));
  check("画面: 必須の不足を名指しで出す", panel.includes("評価に必要な指標が埋まっていません"));

  check("画面: 測定頻度を選べる", panel.includes("FREQUENCY_LABEL"));
  check("画面: 評価時点を足せる", panel.includes("＋ 評価時点を追加"));
  check("画面: 相対年次で指定できる", panel.includes("第N年度"));
  check("画面: 絶対日付でも指定できる", panel.includes("絶対日付"));
  check("画面: 年次評価をしない計画でも足りると伝える", panel.includes("計画期間ごと」だけで足ります"));

  check("画面: 年度別の事業費を編集できる", panel.includes("年度別の事業費と財源"));
  check("画面: 財源を5区分で持つ", panel.includes("FUNDING_SOURCES.map"));
  check("画面: 財源の食い違いを知らせる", panel.includes("財源内訳の合計が一致しない年度"));
  check("画面: 積算内訳を年度別に持つ", panel.includes("積算内訳（費目 × 年度）"));
  check("画面: 和暦の年度で見せる", panel.includes("fiscalYearLabel"));
  check("画面: 下書きを起こせる", panel.includes("前の工程から下書きを起こす"));
}

console.log(`\ncheck-measure-indicators: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
