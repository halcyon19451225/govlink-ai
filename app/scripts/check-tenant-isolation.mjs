/**
 * check:tenant — テナント境界（自治体）が projects 系の全経路に入っていることを構造的に固定する
 *
 * 背景（2026-09-06 / claude/coe-tenant-isolation.md）:
 *   Coe は認証は全面的に効いていたが、**認可（テナント境界）が projects 系に
 *   1件も実装されていなかった**。
 *     ・ダッシュボードが全自治体の政策を一覧表示していた（WHERE 句なし）
 *     ・api/admin/projects/** の 93 本が URL の UUID を無検証で SQL に渡していた。
 *       読み取りだけでなく UPDATE / DELETE も所有権を見ていなかった
 *     ・middleware の matcher が `/admin/:path*` で、ルートグループ (admin) は
 *       URL に出ないため**どのリクエストにもマッチしていなかった**
 *
 *   自治体直属テーブル（users / resources / org-units / members / knowledge /
 *   templates）は一貫して守られていた。抜けていたのは projects 経由で
 *   テナントに属するリソース群だけ。**個別に直すと必ず抜けが再発する**ので、
 *   新しい route / page が増えたときにここで落ちるようにする。
 *
 * ここが落ちたときの直し方:
 *   API   : const outOfTenant = await requireProjectAccess(session, params.id);
 *           if (outOfTenant) return outOfTenant;
 *   ページ : await assertProjectPage(params.id);
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = 'src/app';
const API_PROJECTS = join(APP, 'api/admin/projects');
const PAGE_PROJECTS = join(APP, '(admin)/projects/[id]');

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

// ---- 1. api/admin/projects/[id]/** の全ハンドラにガードがあるか ----
{
  const files = walk(join(API_PROJECTS, '[id]'), 'route.ts');
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const sessions = (src.match(/const session = await getServerSession\(authOptions\);/g) ?? []).length;
    const guards = (src.match(/requireProjectAccess\(session, params\.id\)/g) ?? []).length;
    if (sessions !== guards) bad.push(`${relative(APP, f)} (session=${sessions} guard=${guards})`);
  }
  must(
    `api/admin/projects/[id]/** の全ハンドラがテナント境界を通っている（${files.length} files）`,
    files.length > 0 && bad.length === 0,
    `ガードの無いハンドラがある: ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` ほか${bad.length - 8}件` : ''}`,
  );
}

// ---- 2. projects/[id]/** の全ページにガードがあるか ----
{
  const files = [...walk(PAGE_PROJECTS, 'page.tsx'), join(PAGE_PROJECTS, 'layout.tsx')];
  const bad = files.filter((f) => {
    try { return !readFileSync(f, 'utf8').includes('assertProjectPage(params.id)'); }
    catch { return true; }
  });
  must(
    `projects/[id]/** の全ページ・layout がテナント境界を通っている（${files.length} files）`,
    files.length > 1 && bad.length === 0,
    `ガードの無いページがある: ${bad.map((f) => relative(APP, f)).slice(0, 8).join(', ')}`,
  );
}

// ---- 3. ダッシュボードが自治体で絞っているか ----
{
  const src = readFileSync(join(APP, '(admin)/dashboard/page.tsx'), 'utf8');
  must(
    'ダッシュボードが自治体で絞り込んでいる',
    /WHERE p\.municipality_id = \$1/.test(src) && !/^\s*void session;\s*$/m.test(src),
    '全自治体の政策が一覧に出る状態に戻っている。他テナントの政策 UUID を配る入口になる',
  );
}

// ---- 4. 政策の新規作成が自治体名で合流していないか ----
{
  const src = readFileSync(join(API_PROJECTS, 'route.ts'), 'utf8');
  must(
    '政策の新規作成が自治体名での合流をしていない',
    !/FROM municipalities WHERE name/i.test(src) && /session\.user\?\.municipalityId/.test(src),
    '「名前で探して無ければ作る」が復活している。テナント未確定の利用者が他自治体に書き込める（§3-5 と同じ穴）',
  );
}

// ---- 5. モジュール権限より先にテナント境界を見ているか ----
{
  const src = readFileSync('src/lib/permissions.ts', 'utf8');
  const tenantAt = src.indexOf('requireProjectAccess');
  const bypassAt = src.indexOf('session.user.isOrgAdmin || session.user.role === "admin"');
  must(
    'requireModulePermission が admin バイパスより前にテナント境界を見ている',
    tenantAt > 0 && bypassAt > 0 && tenantAt < bypassAt,
    'role="admin" の早期 return が、他自治体の政策へのフルアクセスになる',
  );
}

// ---- 6. middleware の matcher が実ルートを指しているか ----
{
  const src = readFileSync('src/middleware.ts', 'utf8');
  must(
    'middleware の matcher が実ルートを指している（ルートグループは URL に出ない）',
    /"\/dashboard\/:path\*"/.test(src) && /"\/projects\/:path\*"/.test(src) && !/"\/admin\/:path\*"/.test(src),
    '`/admin/:path*` は (admin) がルートグループのためどのリクエストにもマッチしない',
  );
}

// ---- 7. 拒否が 404 であること（存在を漏らさない） ----
{
  let src = '';
  try { src = readFileSync('src/lib/tenant.ts', 'utf8'); } catch { /* 無ければ下で FAIL */ }
  must(
    'テナント境界の拒否が 404（403 で存在を漏らしていない）',
    /status: 404/.test(src) && !/status: 403/.test(src),
    '403 だと「その UUID の政策は存在する」ことが漏れ、他テナントの政策を数えられる',
  );
}

console.log(`\ncheck:tenant — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
