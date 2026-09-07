#!/usr/bin/env node
/**
 * テナント（自治体）の棚卸しと、テナント削除
 *
 * 使い方（app/ ディレクトリで実行）:
 *   node scripts/inspect-tenants.mjs                  … 棚卸し（読み取りのみ）
 *   node scripts/inspect-tenants.mjs --delete <uuid>  … テナント削除の下見（中の政策も消える）
 *   node scripts/inspect-tenants.mjs --absorb <消す側uuid> --into <残す側uuid>
 *                                                     … 政策を移してからテナントを畳む下見
 *   いずれも --yes を足したときだけ COMMIT する。付けなければ ROLLBACK（下見）。
 *
 * 接続情報は run-migration.mjs と同じく app/.env.local の DATABASE_URL を使う。
 * 認証情報は出力しない。
 *
 * 背景（2026-09-06 / claude/coe-tenant-isolation.md）:
 *   テナント境界を締めた結果、複数自治体に所属する利用者は「最も古い所属」に固定され、
 *   もう一方のテナントの政策は見えなくなった。`slug` が `dept-…` のテナントは
 *   `api/admin/projects` の POST にあった「担当課名で探して無ければ作る」経路で
 *   作られたもので、その経路は c3e3846 で削除済み。残骸なら消せば複数所属も解消する。
 *
 * ⚠ 削除は **municipalities の1行**を消し、外部キーの ON DELETE に従って連鎖する。
 *   **どのテーブルがどう連鎖するかは、この棚卸しの■4が DB から引いて表示する。**
 *   マイグレーションのファイルを読んで列名を推測しないこと（一度それで実在しない列を
 *   数えようとして落ちた）。正本は pg_constraint。
 */
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(APP_ROOT, ".env.local");
  if (!existsSync(envFile)) return null;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const args = process.argv.slice(2);
const delIdx = args.indexOf("--delete");
const targetId = delIdx >= 0 ? args[delIdx + 1] : null;
const absIdx = args.indexOf("--absorb");
const absorbFrom = absIdx >= 0 ? args[absIdx + 1] : null;
const intoIdx = args.indexOf("--into");
const absorbInto = intoIdx >= 0 ? args[intoIdx + 1] : null;
const confirmed = args.includes("--yes");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (delIdx >= 0 && !UUID_RE.test(targetId ?? "")) {
  console.error("✗ --delete には自治体の id（UUID）を渡してください。");
  console.error("  slug のパターン指定は受け付けません（消す対象を取り違えないため）。");
  process.exit(1);
}
if (absIdx >= 0 && (!UUID_RE.test(absorbFrom ?? "") || !UUID_RE.test(absorbInto ?? ""))) {
  console.error("✗ --absorb <吸収される自治体のid> --into <受け入れる自治体のid> の形で、");
  console.error("  どちらも UUID を渡してください。");
  process.exit(1);
}
if (delIdx >= 0 && absIdx >= 0) {
  console.error("✗ --delete と --absorb は同時に使えません。");
  process.exit(1);
}

const connectionString = readDatabaseUrl();
if (!connectionString) {
  console.error("✗ DATABASE_URL が見つかりません（環境変数か app/.env.local）");
  process.exit(1);
}
console.log(`接続先: ${connectionString.replace(/\/\/[^@]*@/, "//***@").split("?")[0]}\n`);

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 60_000, // Aurora Serverless v2 は min 0 ACU のため起動待ちが要る
});
const client = await pool.connect();

const table = (rows) => {
  if (rows.length === 0) return console.log("  （該当なし）");
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (cells) => "  " + cells.map((v, i) => String(v ?? "").padEnd(w[i])).join("  ");
  console.log(line(cols));
  console.log("  " + w.map((n) => "-".repeat(n)).join("  "));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
};

try {
  // ── 1. テナント一覧 ───────────────────────────
  console.log("■ テナント一覧");
  const muni = await client.query(`
    SELECT m.id, m.name, m.slug, m.prefecture,
           to_char(m.created_at,'YYYY-MM-DD') AS created,
           (SELECT count(*) FROM projects      p WHERE p.municipality_id = m.id) AS projects,
           (SELECT count(*) FROM user_roles    u WHERE u.municipality_id = m.id) AS user_roles,
           (SELECT count(*) FROM subscriptions s WHERE s.municipality_id = m.id) AS subs,
           (SELECT count(*) FROM org_units     o WHERE o.municipality_id = m.id) AS org_units
    FROM municipalities m ORDER BY m.created_at`);
  table(muni.rows);

  // ── 2. 各テナントの政策に実データがあるか ────────
  console.log("\n■ 政策ごとの中身（0 ばかりなら「作っただけ」）");
  const proj = await client.query(`
    SELECT m.name AS tenant, p.title, to_char(p.created_at,'YYYY-MM-DD') AS created,
           (SELECT count(*) FROM kpis           k WHERE k.project_id = p.id) AS kpis,
           (SELECT count(*) FROM project_goals  g WHERE g.project_id = p.id) AS goals,
           (SELECT count(*) FROM logic_models   l WHERE l.project_id = p.id) AS logic,
           (SELECT count(*) FROM documents      d WHERE d.project_id = p.id) AS docs,
           (SELECT count(*) FROM posts          o WHERE o.project_id = p.id) AS posts,
           (SELECT count(*) FROM schedule_tasks t WHERE t.project_id = p.id) AS tasks
    FROM projects p JOIN municipalities m ON m.id = p.municipality_id
    ORDER BY m.created_at, p.created_at`);
  table(proj.rows);

  // ── 3. 所属（複数所属の把握） ─────────────────
  console.log("\n■ 所属（同じ人が複数テナントに居ないか）");
  const roles = await client.query(`
    SELECT u.email, m.name AS tenant, u.role,
           to_char(u.created_at,'YYYY-MM-DD') AS created,
           (SELECT count(*) FROM user_identities i WHERE i.user_role_id = u.id) AS identities
    FROM user_roles u JOIN municipalities m ON m.id = u.municipality_id
    ORDER BY u.email, u.created_at`);
  table(roles.rows);

  // ── 4. municipalities を参照する外部キーを **DB から** 引く ──
  //
  // ⚠ ここはマイグレーションファイルを読んで列名を推測してはいけない。
  //   最初そうしたら、実在しない列（plan_templates.shared_by_municipality_id）を
  //   数えようとして落ちた。正本は pg_constraint。
  console.log("\n■ municipalities を参照している外部キー（削除時の挙動つき）");
  const fks = await client.query(`
    SELECT c.conrelid::regclass::text AS tbl,
           a.attname                  AS col,
           CASE c.confdeltype WHEN 'c' THEN 'CASCADE'
                              WHEN 'n' THEN 'SET NULL'
                              WHEN 'd' THEN 'SET DEFAULT'
                              WHEN 'r' THEN 'RESTRICT'
                              ELSE 'NO ACTION' END AS on_delete
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f' AND c.confrelid = 'municipalities'::regclass
    ORDER BY on_delete, tbl`);
  table(fks.rows);

  // CASCADE でないものだけ、テナントごとに件数を数える（ここに行があると DELETE は止まる）
  const blockers = fks.rows.filter((r) => r.on_delete !== 'CASCADE' && r.on_delete !== 'SET NULL');
  console.log("\n■ 削除をブロックしうる参照（CASCADE / SET NULL 以外）の件数");
  if (blockers.length === 0) {
    console.log("  （そういう外部キーはありません）");
  } else {
    const parts = blockers.map((b, i) =>
      `(SELECT count(*) FROM ${b.tbl} x${i} WHERE x${i}.${b.col} = m.id) AS "${b.tbl}.${b.col}"`);
    const q = await client.query(
      `SELECT m.name AS tenant, ${parts.join(", ")} FROM municipalities m ORDER BY m.created_at`);
    table(q.rows);
  }

  // ── 5. 中身が「テンプレートの自動生成」か「人が作ったもの」か ──
  //
  // 件数だけでは判断できない。schedule_tasks が18件あっても、
  // それがテンプレート由来なら実質「作っただけ」。
  console.log("\n■ 政策の中身の内訳（テンプレート由来か、人の入力か）");
  const detail = await client.query(`
    SELECT m.name AS tenant, p.title,
           p.template_id IS NOT NULL AS from_template,
           to_char(p.created_at,'YYYY-MM-DD HH24:MI') AS created,
           to_char(p.updated_at,'YYYY-MM-DD HH24:MI') AS updated
    FROM projects p JOIN municipalities m ON m.id = p.municipality_id
    ORDER BY m.created_at, p.created_at`);
  table(detail.rows);

  // ⚠ 列名を仮定しない。行全体を JSON にして「中身の量」で判断する
  //   （空の器なら数百バイト、人が書き込んでいれば桁が変わる）
  console.log("\n■ ロジックモデルの中身の量（行全体のJSONバイト数。小さいなら空の器）");
  const lm = await client.query(`
    SELECT m.name AS tenant, p.title,
           length(to_jsonb(l)::text) AS row_bytes,
           to_char(l.created_at,'YYYY-MM-DD HH24:MI') AS created,
           to_char(l.updated_at,'YYYY-MM-DD HH24:MI') AS updated
    FROM logic_models l
    JOIN projects p ON p.id = l.project_id
    JOIN municipalities m ON m.id = p.municipality_id
    ORDER BY m.created_at`);
  table(lm.rows);

  console.log("\n■ スケジュールタスクの様子（先頭5件・完了済みが0ならテンプレの器）");
  const tasks = await client.query(`
    SELECT m.name AS tenant, count(*) AS total,
           count(*) FILTER (WHERE t.completed_at IS NOT NULL) AS completed,
           min(to_char(t.created_at,'YYYY-MM-DD')) AS first_created,
           max(to_char(t.created_at,'YYYY-MM-DD')) AS last_created
    FROM schedule_tasks t
    JOIN projects p ON p.id = t.project_id
    JOIN municipalities m ON m.id = p.municipality_id
    GROUP BY m.name, m.created_at ORDER BY m.created_at`);
  table(tasks.rows);

  if (absIdx >= 0) {
    // ── 吸収: 政策を移してからテナントを削除 ──────────
    //
    // 「テナントは消したいが、中の政策は残したい」ときの手順。
    // 政策を先に移すことで、DELETE の CASCADE が政策まで届かなくなる。
    // 消えるのは municipalities の行と、それにぶら下がる user_roles（→ user_identities）だけ。
    const from = muni.rows.find((r) => r.id === absorbFrom);
    const into = muni.rows.find((r) => r.id === absorbInto);
    if (!from) { console.error(`\n✗ id=${absorbFrom} の自治体は存在しません。`); process.exit(1); }
    if (!into) { console.error(`\n✗ id=${absorbInto} の自治体は存在しません。`); process.exit(1); }
    if (from.id === into.id) { console.error("\n✗ 同じ自治体です。"); process.exit(1); }

    console.log(`\n■ 吸収: ${from.name}（${from.slug}） → ${into.name}（${into.slug}）`);

    await client.query("BEGIN");

    const moved = await client.query(
      "UPDATE projects SET municipality_id = $1, updated_at = now() WHERE municipality_id = $2 RETURNING title",
      [absorbInto, absorbFrom]);
    console.log(`  政策を ${moved.rowCount} 件移しました: ${moved.rows.map((r) => r.title).join(", ") || "（なし）"}`);

    // 移し先に既に同名の所属があるなら、吸収元の user_roles は消えて問題ない
    const dropped = await client.query(
      "DELETE FROM municipalities WHERE id = $1 RETURNING name", [absorbFrom]);
    console.log(`  ${dropped.rows.map((r) => r.name).join(", ")} を削除しました（user_roles は連鎖削除）`);

    const after = await client.query(`
      SELECT m.name, m.slug,
             (SELECT count(*) FROM projects   p WHERE p.municipality_id = m.id) AS projects,
             (SELECT count(*) FROM user_roles u WHERE u.municipality_id = m.id) AS user_roles,
             (SELECT to_jsonb(s) ->> 'plan'   FROM subscriptions s WHERE s.municipality_id = m.id LIMIT 1) AS stripe_plan,
             (SELECT to_jsonb(s) ->> 'status' FROM subscriptions s WHERE s.municipality_id = m.id LIMIT 1) AS sub_status,
             (to_jsonb(m) ->> 'org_code') IS NOT NULL AS has_org_code
      FROM municipalities m ORDER BY m.created_at`);
    console.log("\n  実行後:");
    table(after.rows);

    const stillMulti = await client.query(`
      SELECT u.email, count(*) AS tenants FROM user_roles u
      GROUP BY u.email HAVING count(*) > 1`);
    console.log("\n  複数テナントに所属したままの人:");
    table(stillMulti.rows);

    // ⚠ 実効プランは max(Stripe側, 組織コード側)。ここに出るのは Stripe 側の生の値だけで、
    //   org_code があれば Ordo 台帳への照会で上がりうる（外部APIなのでここでは引かない）。
    console.log("\n  ⚠ プラン上限（政策数）: free=1 / light=3 / standard=10 / premium=無制限");
    console.log("     実効プランは max(stripe_plan, 組織コード由来のプラン)。has_org_code が true なら");
    console.log("     Ordo 台帳の契約で上がっている可能性があるため、上の stripe_plan だけでは判断できません。");
    console.log("     なおこの吸収処理は checkLimit を通らないので、上限に関わらず実行はできます。");
    console.log("     効いてくるのは「次に新しい政策を登録するとき」だけです。");

    if (confirmed) {
      await client.query("COMMIT");
      console.log("\n✓ COMMIT しました。取り消せません。");
    } else {
      await client.query("ROLLBACK");
      console.log("\n↩ ROLLBACK しました（下見なので何も変わっていません）。");
      console.log("  この結果でよければ、同じコマンドに --yes を足して実行してください。");
    }
  } else if (delIdx < 0) {
    console.log("\n■ 次にできること");
    console.log("  テナントを消す（中の政策も一緒に消える）:");
    console.log("    node scripts/inspect-tenants.mjs --delete <uuid>        （下見）");
    console.log("    node scripts/inspect-tenants.mjs --delete <uuid> --yes  （実行）");
    console.log("  政策を残したままテナントだけ畳む:");
    console.log("    node scripts/inspect-tenants.mjs --absorb <消す側uuid> --into <残す側uuid>        （下見）");
    console.log("    node scripts/inspect-tenants.mjs --absorb <消す側uuid> --into <残す側uuid> --yes  （実行）");
  } else {
    // ── 削除 ────────────────────────────────
    const target = muni.rows.find((r) => r.id === targetId);
    if (!target) {
      console.error(`\n✗ id=${targetId} の自治体は存在しません。上の一覧から id を選んでください。`);
      process.exit(1);
    }
    console.log(`\n■ 削除対象: ${target.name}（slug=${target.slug} / id=${target.id}）`);

    await client.query("BEGIN");
    const del = await client.query("DELETE FROM municipalities WHERE id = $1", [targetId]);
    console.log(`  municipalities から ${del.rowCount} 行を削除（連鎖削除を含む）`);

    const after = await client.query(`
      SELECT m.name, m.slug,
             (SELECT count(*) FROM projects   p WHERE p.municipality_id = m.id) AS projects,
             (SELECT count(*) FROM user_roles u WHERE u.municipality_id = m.id) AS user_roles
      FROM municipalities m ORDER BY m.created_at`);
    console.log("\n  削除後のテナント:");
    table(after.rows);

    if (confirmed) {
      await client.query("COMMIT");
      console.log("\n✓ COMMIT しました。取り消せません。");
    } else {
      await client.query("ROLLBACK");
      console.log("\n↩ ROLLBACK しました（下見なので何も消えていません）。");
      console.log("  この結果でよければ、同じコマンドに --yes を足して実行してください。");
    }
  }
} catch (e) {
  try { await client.query("ROLLBACK"); } catch { /* トランザクション外なら無視 */ }
  console.error("\n✗ エラー:", e.message);
  if (e.code === "23503") {
    console.error("  外部キー違反です。CASCADE の無いテーブルに行が残っています（上の■4を参照）。");
    console.error("  先にその行を片付けるか、削除をやめてください。");
  }
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
