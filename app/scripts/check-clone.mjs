#!/usr/bin/env node
/**
 * 次期計画の複製（PL1 P①）の検証 — check:clone
 *
 * この検査を作った理由:
 *   複製は information_schema 方式（列を手で並べない）だが、それが本当に
 *   全列を運んでいるか・FK（KPI階層/LM要素のkpi_ids/施策のkpi_ids_*）を
 *   正しく張り替えているかは**実DBでしか確かめられない**。
 *   複製漏れは「次期計画を作った瞬間に内容の一部が消える」事故になる（L5と同じ理由）。
 *
 * 必要なもの:
 *   使い捨ての PostgreSQL（001〜048適用済み）。CLONE_TEST_DATABASE_URL で指定。
 *   接続できない場合はスキップする。※実際に行を作るので本番DBを指さないこと。
 *
 * 使い方:
 *   CLONE_TEST_DATABASE_URL=postgres://... node scripts/check-clone.mjs
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(here, "..");
const URL_ = process.env.CLONE_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/clonetest";

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// ── 純関数（DBなしで常に検証）────────────────────────────
const work = mkdtempSync(join(tmpdir(), "clone-"));
const outFile = join(work, "clone.mjs");
try {
  execFileSync(
    "npx",
    [
      "--no-install",
      "esbuild",
      join(APP_ROOT, "src", "lib", "plan", "clone.ts"),
      "--bundle",
      "--format=esm",
      "--target=es2020",
      "--platform=neutral",
      "--external:pg",
      `--alias:@=${join(APP_ROOT, "src")}`,
      `--outfile=${outFile}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const m = await import(pathToFileURL(outFile).href);
  const map = new Map([["old-1", "new-1"]]);
  const remapped = m.remapElementKpiIds(
    [{ id: "e1", text: "x", kpi_ids: ["old-1", "unknown"] }, "文字列要素（後方互換）"],
    map,
  );
  check("remapElementKpiIds: 対応ありは張替え・無しは落とす・文字列要素は保持",
    remapped[0].kpi_ids.length === 1 && remapped[0].kpi_ids[0] === "new-1" && remapped[1] === "文字列要素（後方互換）");
  check("remapIdArray: 対応の無いIDを落とす", JSON.stringify(m.remapIdArray(["old-1", "zzz"], map)) === '["new-1"]');
  check("LM_ELEMENT_SECTIONS: 三層アウトカム＋長期を含む",
    m.LM_ELEMENT_SECTIONS.includes("initial_outcomes") && m.LM_ELEMENT_SECTIONS.includes("long_outcomes"));

  // ── P②: 取り込み提案のサニタイズ（純関数）──────────────
  const hiFile = join(work, "handoverIntake.mjs");
  execFileSync(
    "npx",
    ["--no-install", "esbuild", join(APP_ROOT, "src", "lib", "plan", "handoverIntake.ts"),
     "--bundle", "--format=esm", "--target=es2020", "--platform=neutral", "--external:pg",
     `--alias:@=${join(APP_ROOT, "src")}`, `--outfile=${hiFile}`],
    { stdio: ["ignore", "ignore", "pipe"], cwd: APP_ROOT },
  );
  const hi = await import(pathToFileURL(hiFile).href);
  const ids = { measureIds: new Set(["m-1"]), kpiIds: new Set(["k-1"]) };
  let r = hi.sanitizeIntakeProposals({ proposals: [
    { type: "measure_update", measure_id: "m-1", section: "intervention", proposal: "介入を見直す", from_action_title: "改善A" },
    { type: "measure_update", measure_id: "m-999", section: "intervention", proposal: "存在しない施策への提案" },
    { type: "kpi_target", kpi_id: "k-1", proposed_target: 80, proposed_deadline: "2029-03-31", rationale: "未達アウトカム◯に対応" },
    { type: "kpi_target", kpi_id: "k-404", rationale: "存在しないKPI" },
    { type: "kpi_target", kpi_id: "k-1", proposed_target: "not-a-number", proposed_deadline: "2029/03/31", rationale: "型不正は落として提案は残す" },
    { type: "improvement_action", title: "住民周知の強化", detail: "内容", root_cause: "真因X" },
    { type: "lm_element_edit", section: "initial_outcomes", element_id: "o1", new_text: "参加率の向上（周知経路を拡充）", rationale: "未達アウトカム対応" },
    { type: "lm_element_edit", section: "bad_section", new_text: "x", rationale: "y" },
  ] }, ids);
  check("intake: 実在IDの提案だけ通す（施策・KPI）", r.proposals.filter((p) => p.type === "measure_update").length === 1 && r.proposals.filter((p) => p.type === "kpi_target").length === 2);
  check("intake: 存在しないIDは理由つきで捨てる", r.rejected.some((x) => x.reason.includes("m-999")) && r.rejected.some((x) => x.reason.includes("k-404")));
  const badNum = r.proposals.find((p) => p.type === "kpi_target" && p.rationale.includes("型不正"));
  check("intake: 数値・日付の不正は null に落とし提案は残す", badNum?.proposed_target === null && badNum?.proposed_deadline === null);
  check("intake: LMセクション語彙外は捨てる", r.proposals.filter((p) => p.type === "lm_element_edit").length === 1);
  check("intake: 不正入力は空", hi.sanitizeIntakeProposals(null, ids).proposals.length === 0);

  // ── P②: 適用ルートの静的検査 ───────────────────────────
  const { readFileSync: rf, existsSync: ex } = await import("node:fs");
  const applyPath = join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "handover-intake", "apply", "route.ts");
  check("apply ルートが存在する", ex(applyPath));
  const applySrc = ex(applyPath) ? rf(applyPath, "utf-8") : "";
  check("apply: 1トランザクション", applySrc.includes("transaction(async"));
  check("apply: サーバー側で再サニタイズ（クライアントを信じない）", applySrc.includes("sanitizeIntakeProposals"));
  check("apply: LM修正はreviseで改訂版を起こしてから（直接上書きしない）", applySrc.includes("reviseLogicModel") && applySrc.includes("前期引き継ぎの取込"));
  check("apply: 改善起票は source='handover'＋リネージFK", applySrc.includes("'handover'") && applySrc.includes("plan_handover_id"));
  check("apply: 数値提案があるときだけ要見直しフラグを下ろす", applySrc.includes("target_needs_review = CASE WHEN"));
  check("apply: 適用後に consumed へ遷移", applySrc.includes("status = 'consumed'"));
  const cloneRoutePath = join(APP_ROOT, "src", "app", "api", "admin", "projects", "[id]", "clone-next-period", "route.ts");
  check("clone ルート: 1トランザクション（半端な計画を残さない）", ex(cloneRoutePath) && rf(cloneRoutePath, "utf-8").includes("transaction("));

  // ── 実DB検証 ───────────────────────────────────────────
  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.log(`check-clone: ${passed} passed, ${failed} failed（pg無しのため実DB検証はスキップ）`);
    process.exit(failed === 0 ? 0 : 1);
  }
  const pool = new pg.default.Pool({ connectionString: URL_, connectionTimeoutMillis: 3000 });
  let client;
  try {
    client = await pool.connect();
  } catch {
    console.log(`check-clone: ${passed} passed, ${failed} failed（DB ${URL_} に接続できないため実DB検証はスキップ。本番DBは指定しないこと）`);
    process.exit(failed === 0 ? 0 : 1);
  }

  try {
    await client.query("BEGIN");

    // ── テストデータ（前期計画）────────────────────
    const muni = await client.query(
      `INSERT INTO municipalities (name, slug, prefecture) VALUES ('検証町', 'clone-test-${Date.now()}', '検証県') RETURNING id`,
    );
    const muniId = muni.rows[0].id;
    const proj = await client.query(
      `INSERT INTO projects (municipality_id, title, description, status, plan_start_date, plan_end_date, department_name, purpose)
       VALUES ($1, '第9期検証計画', '説明文', 'active', '2024-04-01', '2027-03-31', '福祉課', '目的文') RETURNING id`,
      [muniId],
    );
    const srcId = proj.rows[0].id;

    const k1 = await client.query(
      `INSERT INTO kpis (project_id, label, target, current, unit, indicator_type, baseline_value)
       VALUES ($1, '長期KPI', 100, 60, '%', 'outcome_long', 40) RETURNING id`,
      [srcId],
    );
    const k2 = await client.query(
      `INSERT INTO kpis (project_id, label, target, current, unit, indicator_type, contributes_to_kpi_id)
       VALUES ($1, '短期KPI', 50, 20, '件', 'outcome_initial', $2) RETURNING id`,
      [srcId, k1.rows[0].id],
    );
    await client.query(
      `INSERT INTO project_pdca_checkpoints (project_id, name, cycle_type, phase, scheduled_date, status, completed_at, completion_notes)
       VALUES ($1, '中間評価', 'annual', 'C', '2025-10-01', 'completed', now(), '完了メモ')`,
      [srcId],
    );
    await client.query(
      `INSERT INTO logic_models (project_id, name, version, is_current, status, inputs, activities, initial_outcomes, edges)
       VALUES ($1, '検証LM', 3, true, 'confirmed',
               '[{"id":"i1","text":"予算","kpi_ids":[]}]'::jsonb,
               '[{"id":"a1","text":"サロン運営","kpi_ids":[]}]'::jsonb,
               $2::jsonb,
               '[{"from":"a1","to":"o1"}]'::jsonb) RETURNING id`,
      [srcId, JSON.stringify([{ id: "o1", text: "参加率向上", kpi_ids: [k2.rows[0].id, "dead-beef"] }])],
    );
    await client.query(
      `INSERT INTO measure_designs (project_id, title, status, committed_at, intervention, evidence_status,
                                    evidence_items, kpi_ids_initial, total_budget)
       VALUES ($1, '検証施策', 'confirmed', now(), '介入内容', 'sufficient',
               '[{"title":"根拠","source":"出典","design":"rct","evidence_level":4,"effect_summary":"効果"}]'::jsonb,
               $2::uuid[], 1000000)`,
      [srcId, [k2.rows[0].id]],
    );
    await client.query(
      `INSERT INTO plan_handovers (source_project_id, title, package, status, finalized_at)
       VALUES ($1, '引き継ぎ', '{}'::jsonb, 'finalized', now())`,
      [srcId],
    );

    // ── 複製実行 ───────────────────────────────────
    const { cloneNextPeriod } = m;
    const result = await cloneNextPeriod(client, {
      sourceProjectId: srcId,
      title: "第10期検証計画",
      planStartDate: "2027-04-01",
      planEndDate: "2030-03-31",
    });
    check("複製が完了する", result != null && typeof result.newProjectId === "string");
    const newId = result.newProjectId;
    check("期間シフトが日数で計算される（3年=1095日）", result.dayShift === 1095 || result.dayShift === 1096);
    check("件数: KPI2・チェックポイント1・施策1・LMあり",
      result.counts.kpis === 2 && result.counts.checkpoints === 1 && result.counts.measures === 1 && result.counts.logicModel === true);
    check("finalized引き継ぎが新計画に結線される", result.handoverLinked === true);

    // ── 全列運搬（managed以外の列が一致すること）────
    const carriedEqual = async (table, srcWhere, dstWhere, managed) => {
      const cols = (
        await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = $1 AND table_schema = current_schema()`,
          [table],
        )
      ).rows.map((r) => r.column_name).filter((c) => !managed.includes(c));
      const s = (await client.query(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM ${table} WHERE ${srcWhere}`)).rows[0];
      const d = (await client.query(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM ${table} WHERE ${dstWhere}`)).rows[0];
      if (!s || !d) return { ok: false, diff: ["行が見つからない"] };
      const diff = cols.filter((c) => JSON.stringify(s[c]) !== JSON.stringify(d[c]));
      return { ok: diff.length === 0, diff };
    };

    const pj = await carriedEqual("projects", `id = '${srcId}'`, `id = '${newId}'`,
      ["id", "title", "status", "plan_start_date", "plan_end_date", "cloned_from_project_id", "created_at", "updated_at"]);
    check(`projects: 管理列以外の全列を運搬${pj.ok ? "" : `（差分: ${pj.diff.join(",")}）`}`, pj.ok);

    const newProj = (await client.query(`SELECT title, status, cloned_from_project_id, to_char(plan_start_date,'YYYY-MM-DD') AS s FROM projects WHERE id = $1`, [newId])).rows[0];
    check("projects: draft・新標題・系譜・新期間", newProj.status === "draft" && newProj.title === "第10期検証計画" && newProj.cloned_from_project_id === srcId && newProj.s === "2027-04-01");

    // KPI: baseline←前期実績・要見直し・階層張替え
    const nk = (await client.query(
      `SELECT label, target::float AS target, baseline_value::float AS b, previous_value::float AS pv,
              previous_target::float AS pt, target_needs_review, cloned_from_kpi_id, contributes_to_kpi_id
       FROM kpis WHERE project_id = $1 ORDER BY label`, [newId])).rows;
    const nLong = nk.find((r) => r.label === "長期KPI");
    const nShort = nk.find((r) => r.label === "短期KPI");
    check("KPI: baseline ← 前期の最新実績値", nLong?.b === 60 && nShort?.b === 20);
    check("KPI: previous_value/target に前期値を退避", nLong?.pv === 60 && nLong?.pt === 100);
    check("KPI: target据え置き＋要見直しフラグ", nLong?.target === 100 && nk.every((r) => r.target_needs_review === true));
    check("KPI: 系譜（cloned_from_kpi_id）", nLong?.cloned_from_kpi_id === k1.rows[0].id);
    const newLongId = (await client.query(`SELECT id FROM kpis WHERE project_id=$1 AND label='長期KPI'`, [newId])).rows[0].id;
    check("KPI: 階層（contributes_to_kpi_id）を新IDへ張替え", nShort?.contributes_to_kpi_id === newLongId);

    // チェックポイント: 日付シフト・状態リセット
    const ncp = (await client.query(
      `SELECT to_char(scheduled_date,'YYYY-MM-DD') AS d, status, completed_at, completion_notes FROM project_pdca_checkpoints WHERE project_id = $1`, [newId])).rows[0];
    check("チェックポイント: 期間差分だけ日付シフト", ncp.d === "2028-09-30" || ncp.d === "2028-10-01");
    check("チェックポイント: 実績をリセット（upcoming・完了情報なし）", ncp.status === "upcoming" && ncp.completed_at === null && ncp.completion_notes === null);

    // LM: 第1版・系譜・kpi_ids張替え（対応なしIDは落ちる）
    const nlm = (await client.query(
      `SELECT version, is_current, status, cloned_from_logic_model_id, cloned_from_project_id, initial_outcomes, edges, name
       FROM logic_models WHERE project_id = $1`, [newId])).rows[0];
    check("LM: 新計画の第1版（is_current・draft・系譜）", nlm.version === 1 && nlm.is_current === true && nlm.status === "draft" && nlm.cloned_from_project_id === srcId);
    const newShortId = (await client.query(`SELECT id FROM kpis WHERE project_id=$1 AND label='短期KPI'`, [newId])).rows[0].id;
    const io = nlm.initial_outcomes;
    check("LM: 要素のkpi_idsを新IDへ張替え・対応なしIDは落とす", Array.isArray(io) && io[0].kpi_ids.length === 1 && io[0].kpi_ids[0] === newShortId);
    check("LM: 因果エッジ・名称など内容は保持", Array.isArray(nlm.edges) && nlm.edges[0].from === "a1" && nlm.name === "検証LM");

    // 施策: draft化・C区画保持・kpi_ids張替え
    const nmd = (await client.query(
      `SELECT status, committed_at, intervention, evidence_status, evidence_items, kpi_ids_initial, total_budget::float AS b, cloned_from_measure_id
       FROM measure_designs WHERE project_id = $1`, [newId])).rows[0];
    check("施策: status→draft・committed_atリセット", nmd.status === "draft" && nmd.committed_at === null);
    check("施策: エビデンスC区画・内容・コストを保持", nmd.evidence_status === "sufficient" && nmd.evidence_items[0].design === "rct" && nmd.intervention === "介入内容" && nmd.b === 1000000);
    check("施策: kpi_ids_initial を新IDへ張替え", nmd.kpi_ids_initial.length === 1 && nmd.kpi_ids_initial[0] === newShortId);

    // 実績・過程は持ち込まれない
    const nEval = (await client.query(`SELECT count(*)::int AS n FROM program_evaluations WHERE project_id = $1`, [newId])).rows[0].n;
    const nRep = (await client.query(`SELECT count(*)::int AS n FROM kpi_reports WHERE kpi_id IN (SELECT id FROM kpis WHERE project_id = $1)`, [newId])).rows[0].n;
    check("実績（評価・KPI報告）は持ち込まれない", nEval === 0 && nRep === 0);

    await client.query("ROLLBACK"); // テストデータは残さない
    console.log(`check-clone: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    console.error("check-clone: 実DB検証中にエラー:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
