/**
 * check:register — 公開の自己登録エンドポイントが閉じたままであることを固定する
 *
 * 背景（1）テナント乗っ取り（2026-09-06 に発見・修正）:
 *   /api/auth/register は middleware の matcher 外＝**未認証で公開**されている。
 *   にもかかわらず自治体を「名前一致」で検索して既存レコードに合流させ、
 *   user_roles を role='admin' 固定で作っていた。第三者が公開情報である自治体名
 *   （例:「御船町」）を送るだけで、その自治体テナントの管理者になれる状態だった。
 *
 * 背景（2）閉鎖（2026-09-12）:
 *   Coe は完全有償化し、導入を「契約 → Ordo が組織を作成 → 管理者を Ordo ID で
 *   招待」の1本に統一した。加えて自己登録はそもそも成立していなかった
 *   （user_identities を作らないので登録直後から fail closed、
 *     トライアルは plan='free' なので初日から締め出し）。
 *   そこでエンドポイントを 410 固定にした。
 *
 * ここが落ちたら、自己登録が復活している。**再び開けるなら、**
 * user_identities の作成・トライアルの実体・Ordo 台帳との整合・テナント乗っ取り対策
 * を同時に用意すること。詳細は route.ts のコメントと claude/coe-provisioning.md。
 *
 * ※ これは構造チェック（ソースの形の検査）であって、DBを使った機能テストではない。
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/app/api/auth/register/route.ts';
const src = readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const must = (name, cond, why) => {
  if (cond) { console.log(`  ok   ${name}`); pass++; }
  else { console.log(` FAIL  ${name}\n       ${why}`); fail++; }
};

must(
  '自己登録が 410 で閉じている',
  /status:\s*410/.test(src),
  '公開の自己登録が復活している。開けるなら route.ts のコメントにある4点を同時に満たすこと',
);

must(
  'Cognito のサインアップを行っていない',
  !/SignUpCommand/.test(src),
  '未認証のエンドポイントから Cognito ユーザーを作っている。'
    + '任意の宛先へ確認メールを送れる口になるうえ、Ordo 台帳の外にアカウントが増える',
);

must(
  '自治体テナントを作っていない',
  !/INSERT\s+INTO\s+municipalities/i.test(src),
  '未認証のエンドポイントからテナントを新設している。テナントの新設は契約と人の判断を通すこと',
);

must(
  '権限（user_roles）を作っていない',
  !/INSERT\s+INTO\s+user_roles/i.test(src),
  '未認証のエンドポイントから権限行を作っている。2026-09-06 のテナント乗っ取りと同じ形',
);

must(
  '成立しないトライアルを作っていない',
  !/INSERT\s+INTO\s+subscriptions/i.test(src),
  "plan='free' の trialing は (admin)/layout.tsx が初日から弾くため、"
    + 'トライアルとして機能しない。復活させるなら実際に効くプランを与えること',
);

must(
  '閉じた理由が残っている',
  /2026-09-12 に閉鎖/.test(src) && /user_identities/.test(src),
  '閉鎖の経緯がコードから消えている。次に触る人が「なぜ 410 なのか」を辿れなくなる',
);

console.log(`\ncheck:register — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
