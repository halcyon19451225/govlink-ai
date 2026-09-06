/**
 * check:ordoadmin — 運営者判定が1箇所に集約されていることを構造的に固定する
 *
 * 背景（2026-09-06 の監査 / claude/coe-tenant-isolation.md §8）:
 *   `(ordo-admin)` と `api/ordo-admin/**` は**テナントを越えて**全自治体の
 *   データを読み書きするコンソール。境界が無いのは仕様だが、その代わり
 *   「運営者だけが入れること」がすべての防御になる。
 *
 *   その判定が `session.user.email === "ordoservice.com@gmail.com"` の形で
 *   **28 ファイルに完全重複**していた。1箇所書き忘れれば、そこは全テナントに
 *   対して開いたままになる。テナント境界を tenant.ts に集約したのと同じ理由で
 *   src/lib/ordo-admin.ts に1本化した。ここが落ちたら重複が復活している。
 *
 * ここが落ちたときの直し方:
 *   API   : const denied = await requireOrdoAdmin(); if (denied) return denied;
 *           （既存の session を使う形なら isOrdoAdmin(session) で判定する）
 *   ページ : await assertOrdoAdminPage();
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = 'src/app';
const GUARD_LIB = 'src/lib/ordo-admin.ts';
const API_DIR = join(APP, 'api/ordo-admin');
const PAGE_DIR = join(APP, '(ordo-admin)');
const OPERATOR_EMAIL = 'ordoservice.com@gmail.com';

let pass = 0, fail = 0;
const must = (name, cond, why) => {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(` FAIL  ${name}\n       ${why}`); fail++; }
};

function walk(dir, name) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, name));
    else if (e === name) out.push(p);
  }
  return out;
}
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ---- 1. 判定の定義が1箇所だけか ----
{
  const offenders = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { scan(p); continue; }
      if (!/\.tsx?$/.test(p)) continue;
      if (p === GUARD_LIB) continue;
      const src = readFileSync(p, 'utf8');
      // 認可判定にメールを直接使っている形だけを拾う（表示条件や連絡先の記載は除く）
      if (new RegExp(`user\\??\\.?email\\s*[!=]==\\s*["']${OPERATOR_EMAIL}["']`).test(src)
          || /ORDO_ADMIN_EMAIL/.test(src)) {
        offenders.push(relative('.', p));
      }
    }
  };
  scan('src');
  must(
    '運営者の判定が src/lib/ordo-admin.ts の外に無い',
    offenders.length === 0,
    `判定が重複している: ${offenders.slice(0, 8).join(', ')}。`
      + '1箇所書き忘れれば、そのルートは全テナントに対して開く',
  );
}

// ---- 2. api/ordo-admin の全ハンドラがガードを通っているか ----
{
  const files = walk(API_DIR, 'route.ts');
  const bad = files.filter((f) => {
    const src = read(f);
    return !/isOrdoAdmin\(|requireOrdoAdmin\(/.test(src);
  });
  must(
    `api/ordo-admin/** の全 route が運営者ガードを通っている（${files.length} files）`,
    files.length > 0 && bad.length === 0,
    `ガードの無い route がある: ${bad.map((f) => relative(APP, f)).slice(0, 8).join(', ')}`,
  );
}

// ---- 3. サーバーコンポーネントのページが layout に依存していないか ----
{
  const files = walk(PAGE_DIR, 'page.tsx').filter((f) => !read(f).trimStart().startsWith('"use client"'));
  const bad = files.filter((f) => !/assertOrdoAdminPage\(\)/.test(read(f)));
  must(
    `(ordo-admin) のサーバーページが自前でも判定している（${files.length} files）`,
    files.length > 0 && bad.length === 0,
    `layout だけに頼っているページがある: ${bad.map((f) => relative(APP, f)).join(', ')}。`
      + 'Next.js の layout は認可の境界にしてはならない（ナビゲーション時に再実行されない）',
  );
}

// ---- 4. layout 自身もガードしているか ----
{
  must(
    '(ordo-admin)/layout.tsx も判定している',
    /isOrdoAdmin\(|assertOrdoAdminPage\(/.test(read(join(PAGE_DIR, 'layout.tsx'))),
    'layout の判定が消えている',
  );
}

// ---- 5. middleware が /ordo-admin を見ているか ----
{
  must(
    'middleware の matcher に /ordo-admin/:path* がある',
    /"\/ordo-admin\/:path\*"/.test(read('src/middleware.ts')),
    'ルートグループ (ordo-admin) は URL に出ない。実 URL は /ordo-admin/*',
  );
}

console.log(`\ncheck:ordoadmin — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
