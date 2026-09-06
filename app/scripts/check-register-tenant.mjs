/**
 * check:register — 公開登録エンドポイントのテナント分離を構造的に固定する
 *
 * 背景（2026-09-06 に発見・修正）:
 *   /api/auth/register は middleware の matcher 外＝**未認証で公開**されている。
 *   にもかかわらず、自治体を「名前一致」で検索して既存レコードに合流させ、
 *   user_roles を role='admin' 固定で作っていた。
 *   その結果、第三者が公開情報である自治体名（例:「御船町」）を送るだけで
 *   その自治体テナントの管理者になれる状態だった（テナント乗っ取り）。
 *
 * ここが落ちたら、その穴が再び開いている。**合流を許す実装に戻してはならない。**
 * 2人目以降の追加は「設定 > ユーザー管理」からの招待に限定する。
 *
 * ※ これは構造チェック（ソースの形の検査）であって、DBを使った機能テストではない。
 */
import { readFileSync } from 'node:fs';

const FILE = 'src/app/api/auth/register/route.ts';
const src = readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
const ok = (name) => { console.log(`  ok   ${name}`); pass++; };
const ng = (name, why) => { console.log(` FAIL  ${name}\n       ${why}`); fail++; };
const must = (name, cond, why) => (cond ? ok(name) : ng(name, why));

must(
  '既存自治体への合流コードが存在しない',
  !/municipalityId\s*=\s*munExisting\s*\[\s*0\s*\]/.test(src),
  '`municipalityId = munExisting[0].id` が復活している。未認証の登録で既存テナントに合流できる',
);

must(
  '自治体の作成が WHERE NOT EXISTS で守られている',
  /INSERT INTO municipalities[\s\S]{0,400}?WHERE NOT EXISTS/i.test(src),
  '自治体の INSERT が無条件になっている。事前チェックとの競合で同名が作られうる',
);

must(
  '重複自治体名を 409 で拒否している',
  /この自治体はすでに登録されています/.test(src) && /status:\s*409/.test(src),
  '既存の自治体名を拒否する 409 の分岐が無い（UsernameExists の 409 と取り違えないこと）',
);

must(
  'Cognito サインアップ前に重複チェックしている',
  src.indexOf('SELECT id FROM municipalities') !== -1 &&
    src.indexOf('SELECT id FROM municipalities') < src.indexOf('new SignUpCommand'),
  '重複チェックが SignUpCommand より後ろにある。確認されない Cognito ユーザーだけが残る',
);

must(
  'role は admin 固定のまま（新規自治体の初回登録者なので正しい）',
  /VALUES \(\$1, \$2, \$3, \$4, 'admin', \$5\)/.test(src),
  "user_roles の INSERT が想定と違う。合流を塞いだ前提が崩れていないか確認すること",
);

console.log(`\ncheck:register — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
