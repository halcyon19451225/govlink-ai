/**
 * check:provisioning — Ordo 台帳からの利用者受け入れが、守るべき性質を保っているか
 *
 * 背景（2026-09-12）:
 *   Ordo の組織管理者ページから招待された利用者は、Cognito には存在するが Coe の
 *   user_roles には存在しない。そのため認証は通るのに fail closed で弾かれていた。
 *   Ordo 台帳（正本）を sub で引いて受け入れるのが src/lib/user-provisioning.ts。
 *
 * ここで固定したいのは、便利さのために静かに壊れやすい4点:
 *   1. 鍵は sub のみ。メール照合に退避しない（2026-09-06 に塞いだ穴）
 *   2. テナント（自治体）を自動作成しない。新設は人の判断を通す
 *   3. 権限を降格させない。Coe 側の運用で付けた role を台帳が上書きしない
 *   4. 「Ordo に到達できない」と「台帳にいない」を区別する。
 *      混同すると Ordo の一時障害が全利用者の権限剥奪になる
 */
import { readFileSync } from 'node:fs';

const PROV = 'src/lib/user-provisioning.ts';
const DIR = 'src/lib/ordo-directory.ts';
const AUTH = 'src/lib/auth.ts';
const prov = readFileSync(PROV, 'utf8');
const dir = readFileSync(DIR, 'utf8');
const auth = readFileSync(AUTH, 'utf8');

let pass = 0, fail = 0;
const must = (name, cond, why) => {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(` FAIL  ${name}\n       ${why}`); fail++; }
};

must(
  '台帳の照会が sub を鍵にしている',
  /resolveOrdoMember\(\s*sub/.test(prov) && /\?sub=\$\{encodeURIComponent\(sub\)\}/.test(dir),
  'sub 以外の鍵で台帳を引いている',
);

must(
  'メールアドレスで利用者を引いていない',
  !/WHERE[\s\S]{0,80}\bemail\s*=/i.test(prov),
  'email による突き合わせが入り込んでいる。メールは可変で複数組織に存在しうるため認可の鍵にしてはならない',
);

must(
  '自治体（テナント）を自動作成していない',
  !/INSERT\s+INTO\s+municipalities/i.test(prov),
  'municipalities を自動で作っている。テナントの新設は人の判断を通すこと',
);

must(
  '対応する自治体が無いときは受け入れずに警告する',
  /no_tenant/.test(prov) && /municipalities 行がありません/.test(prov),
  '自治体が未連携のときの扱いが不明瞭。黙って作る・黙って通すのどちらもしてはならない',
);

must(
  '既存の role を降格させない',
  /降格はしない/.test(prov)
    && /CASE WHEN EXCLUDED\.role = 'admin' THEN 'admin' ELSE user_roles\.role END/.test(prov),
  'Ordo 台帳が Coe 側の role を一方的に上書きしている。付与はしても剥奪はしないこと',
);

must(
  '到達不能と「台帳にいない」を別の結果として扱っている',
  /status:\s*"unreachable"/.test(prov) && /status:\s*"denied"/.test(prov),
  '2つを区別していない。Ordo の一時障害が全利用者の権限剥奪になる',
);

must(
  '到達不能なら権限判断を変えない（auth 側）',
  /outcome\.status !== "unreachable"/.test(auth) && /outcome\.status === "synced"/.test(auth),
  'unreachable のときに row を読み直す・同期済みとして扱うなどして、判断を変えてしまっている',
);

must(
  '台帳の照会に時間の上限がある',
  /AbortSignal\.timeout/.test(dir),
  'Ordo が遅いとログインが無制限に待たされる',
);

must(
  '台帳の照会がサーバー間認証を使っている',
  /x-license-key/.test(dir) && /LICENSE_API_KEY/.test(dir),
  'API キー無しで台帳を引いている。ブラウザから呼べる口にしてはならない',
);

must(
  '毎リクエストでは同期していない',
  /ORDO_SYNC_INTERVAL_MS/.test(auth) && /!row \|\| !!account \|\| stale/.test(auth),
  'jwt コールバックは毎リクエスト走る。無条件に同期すると Ordo への往復が全リクエストに乗る',
);

console.log(`\ncheck:provisioning — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
