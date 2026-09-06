/**
 * check:identity — 権限解決が Cognito の sub のみに基づくことを構造的に固定する
 *
 * 背景（2026-09-06）:
 *   Coe は権限を user_roles.email で解決していた。メールは可変で、同じ値が複数テナントに
 *   存在しうるため認可の鍵として不適切。同じ Cognito プールを一般消費者向け SNS（Libera）が
 *   共有しているので、業務メールで Libera に登録すると業務権限が付く穴にもなっていた。
 *
 *   移行の途中で、1人が Cognito 上に2つの identity を持つことが判明した
 *   （ネイティブのメール+パスワードと Google 連携で sub が別）。そのため
 *   user_identities（user_roles と 1対多）で sub を持つ設計にした。
 *
 * ここが落ちたら、その穴が再び開いている。**email 照合を足し直してはならない。**
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/lib/auth.ts';
const src = readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const must = (name, cond, why) => {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(` FAIL  ${name}\n       ${why}`); fail++; }
};

must(
  'user_roles を email で引いていない',
  !/FROM\s+user_roles[\s\S]{0,200}?WHERE\s+email/i.test(src),
  'email による権限解決が復活している。メールは可変で複数テナントに存在しうるため認可の鍵にしてはならない',
);

must(
  'user_identities を join して sub で引いている',
  /JOIN\s+user_identities[\s\S]{0,200}?WHERE\s+i\.cognito_sub\s*=\s*\$1/i.test(src),
  'sub 基準の権限解決が見当たらない',
);

must(
  '所属が複数のとき決定的に選んでいる（ORDER BY 付き）',
  /ORDER BY u\.created_at[\s\S]{0,40}LIMIT 1/.test(src),
  'ORDER BY なしの LIMIT 1 は順序未定義で、所属テナントが実行ごとに変わりうる',
);

must(
  '複数所属を警告している',
  /membership_count/.test(src) && /所属切替UIは未実装/.test(src),
  '複数所属が黙って握りつぶされている',
);

must(
  'identity 未登録は権限を付けずに警告する（fail closed）',
  /user_identities がありません/.test(src),
  '未登録 identity の扱いが不明瞭。黙って通してはならない',
);

must(
  'identity 未登録のとき既存クレームを削除している（既存セッションの素通り防止）',
  /delete token\.municipalityId/.test(src)
    && /delete token\.role/.test(src)
    && /delete token\.userRoleId/.test(src)
    && /token\.isOrgAdmin\s*=\s*false/.test(src),
  'warn するだけでクレームを消していない。修正前に email 照合で発行されたトークンが '
    + 'municipalityId / role を保持したまま生き続ける（NextAuth の JWT は使い続ける限り失効しない）',
);

must(
  'LINE / GitHub の直付けプロバイダーが復活していない',
  !/LineProvider|GithubProvider/.test(src),
  'Cognito に載せられないプロバイダーが直付けで復活している（sub が Cognito のものにならない）',
);

console.log(`\ncheck:identity — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
