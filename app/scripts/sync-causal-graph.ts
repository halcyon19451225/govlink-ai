/**
 * sync-causal-graph.ts
 * ────────────────────────────────────────────────────────────────────
 * causal-graph.ts を正本として plan_modules.depends_on と
 * module_incompatibility_rules を DB に同期するスクリプト。
 * べき等に実行可能（何度実行しても同じ結果になる）。
 *
 * 実行方法:
 *   # 1. tsx がない場合は先にインストール
 *   npm install --save-dev tsx
 *
 *   # 2. 環境変数を設定（.env.local が存在する場合は自動読み込み）
 *   export DATABASE_URL="postgres://..."
 *
 *   # 3. 実行
 *   npx tsx scripts/sync-causal-graph.ts
 *
 *   # または package.json の scripts に追加してから:
 *   #   "sync-causal-graph": "tsx scripts/sync-causal-graph.ts"
 *   npm run sync-causal-graph
 *
 * 環境変数:
 *   DATABASE_URL  - PostgreSQL 接続文字列（必須）
 *   DRY_RUN=1     - 実際には更新せず差分だけ表示する
 * ────────────────────────────────────────────────────────────────────
 */

import { Client } from "pg";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// .env.local / .env を手動読み込み（Next.js 外で実行するため）
for (const envFile of [".env.local", ".env"]) {
  const p = resolve(__dirname, "..", envFile);
  if (existsSync(p)) {
    const lines = readFileSync(p, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
    console.log(`✓ ${envFile} を読み込みました`);
    break;
  }
}

// causal-graph.ts から直接 import（tsx で実行する前提）
import {
  CAUSAL_EDGES,
  INCOMPATIBLE_RULES,
  buildDependsOnMap,
} from "../src/lib/modules/causal-graph";

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ DATABASE_URL が設定されていません");
    process.exit(1);
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("✓ DB接続成功");

  try {
    await client.query("BEGIN");

    // ─── 1. plan_modules.depends_on を更新 ────────────────────────────
    console.log("\n[1] plan_modules.depends_on を更新します...");
    const dependsOnMap = buildDependsOnMap();

    // DB から現在の plan_modules 一覧を取得
    const { rows: dbModules } = await client.query<{
      id: string;
      depends_on: string[];
    }>("SELECT id, depends_on FROM plan_modules ORDER BY sort_order");

    let depsUpdated = 0;
    for (const dbMod of dbModules) {
      const expected = dependsOnMap[dbMod.id] ?? [];
      const current = dbMod.depends_on ?? [];

      // 順序を無視して比較
      const same =
        expected.length === current.length &&
        expected.every((d) => current.includes(d));

      if (!same) {
        console.log(
          `  ${dbMod.id}: [${current.join(",")}] → [${expected.join(",")}]`,
        );
        if (!DRY_RUN) {
          await client.query(
            "UPDATE plan_modules SET depends_on = $1 WHERE id = $2",
            [expected, dbMod.id],
          );
        }
        depsUpdated++;
      }
    }

    // CAUSAL_EDGES に現れるが plan_modules にないモジュールを警告
    const dbIds = new Set(dbModules.map((m) => m.id));
    const edgeIdArray = Array.from(new Set(CAUSAL_EDGES.flatMap(([a, b]) => [a, b])));
    for (const id of edgeIdArray) {
      if (!dbIds.has(id)) {
        console.warn(
          `  ⚠ CAUSAL_EDGES に '${id}' があるが plan_modules に存在しません`,
        );
      }
    }

    console.log(
      depsUpdated === 0
        ? "  → 差分なし（すでに同期済み）"
        : `  → ${depsUpdated}件 ${DRY_RUN ? "(DRY RUN)" : "更新"}`,
    );

    // ─── 2. module_incompatibility_rules を洗い替え ───────────────────
    console.log("\n[2] module_incompatibility_rules を洗い替えます...");
    console.log(`  定義: ${INCOMPATIBLE_RULES.length}件`);

    if (!DRY_RUN) {
      await client.query("DELETE FROM module_incompatibility_rules");

      for (const rule of INCOMPATIBLE_RULES) {
        await client.query(
          `INSERT INTO module_incompatibility_rules
             (id, module_a, module_b, incompatibility_type,
              is_blocking, warning_message, required_intermediaries)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           ON CONFLICT (module_a, module_b) DO UPDATE SET
             incompatibility_type     = EXCLUDED.incompatibility_type,
             is_blocking              = EXCLUDED.is_blocking,
             warning_message          = EXCLUDED.warning_message,
             required_intermediaries  = EXCLUDED.required_intermediaries`,
          [
            rule.moduleA,
            rule.moduleB,
            rule.type,
            rule.isBlocking,
            rule.warningMessage,
            rule.requiredIntermediaries,
          ],
        );
      }
      console.log(`  → ${INCOMPATIBLE_RULES.length}件 INSERT/UPSERT 完了`);
    } else {
      for (const rule of INCOMPATIBLE_RULES) {
        console.log(`  [DRY] ${rule.moduleA} ⇔ ${rule.moduleB} (${rule.type})`);
      }
    }

    if (!DRY_RUN) {
      await client.query("COMMIT");
      console.log("\n✅ 同期完了（COMMIT）");
    } else {
      await client.query("ROLLBACK");
      console.log("\n✅ ドライラン完了（ROLLBACK）");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ エラーが発生しました:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
