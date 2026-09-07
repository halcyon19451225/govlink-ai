/**
 * check:ratelimit — 未認証エンドポイントのレート制限を構造的に固定する
 *
 * 背景（2026-09-07・claude/coe-tenant-isolation.md §10-7）:
 *   リポジトリ全体にレート制限の実装が1つも無かった（WAF も CAPTCHA も無し）。
 *   未認証で POST を受けるエンドポイントの多くが、1リクエストごとに
 *   **メールを送る**か **DB に行を作る**。とくに /api/contact は、
 *   リクエスト本文の body を、リクエスト本文の email 宛に、自社ドメインから
 *   そのまま送っていた＝任意の文面を任意の宛先へ送れる装置だった。
 *
 * ここが落ちたら、その穴が再び開いている。
 *
 * ⚠ この検査は `node:fs` / `node:path` しか使わない。
 *   check:security は Amplify のデプロイ関門（NODE_ENV=production ＝ dev 依存が
 *   入らない環境）で走るため、esbuild 等に依存すると必ず落ちる（§12-1）。
 *
 * ※ これは構造チェック（ソースの形の検査）であって、実際に 429 が返ることの
 *   機能テストではない。実挙動の確認は scripts/inspect-rate-limits.mjs で行う。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name) => { console.log(`  ok   ${name}`); pass++; };
const ng = (name, why) => { console.log(` FAIL  ${name}\n       ${why}`); fail++; };
const must = (name, cond, why) => (cond ? ok(name) : ng(name, why));

const LIB = 'src/lib/rate-limit.ts';
const MIGRATION = '../infra/migrations/065_rate_limits.sql';

// ── 1. 共通実装が在ること ──────────────────────────────────────
const libSrc = existsSync(LIB) ? readFileSync(LIB, 'utf8') : '';
must(
  '共通のレート制限実装が存在する',
  /export\s+async\s+function\s+enforceRateLimit/.test(libSrc) &&
    /export\s+function\s+clientIpFrom/.test(libSrc),
  `${LIB} が enforceRateLimit / clientIpFrom を export していない。` +
    '各ルートで個別に数える形に戻すと、必ずどこかが漏れる',
);

// ── 2. カウンタが DB にあること（プロセス内メモリは Lambda で効かない）──
must(
  'カウンタを DB に置いている',
  /rate_limits/.test(libSrc) && /ON CONFLICT\s*\(\s*bucket\s*\)/i.test(libSrc),
  'rate_limits テーブルへの upsert が見当たらない。' +
    'Amplify SSR は Lambda なので、Map によるカウンタはインスタンス間で共有されず素通りする',
);

must(
  'rate_limits の migration が存在する',
  existsSync(MIGRATION) && /CREATE TABLE IF NOT EXISTS rate_limits/i.test(readFileSync(MIGRATION, 'utf8')),
  'migration 065 が無い。テーブルが無ければ enforceRateLimit は毎回失敗し、' +
    'fail closed により公開フォームが全部 503 になる',
);

// ── 3. X-Forwarded-For の採り方 ────────────────────────────────
// 先頭は閲覧者が詰められる（偽装できる）。
// 末尾は CloudFront のオリジン向け IP で毎回変わる（2026-09-07 の本番実測）。
// 採るべきは「末尾から TRUSTED_PROXY_HOPS 個を捨てた位置」。
must(
  'X-Forwarded-For の先頭を採っていない',
  !/return\s+parts\s*\[\s*0\s*\]/.test(libSrc) &&
    !/const\s+\w+\s*=\s*parts\s*\[\s*0\s*\]/.test(libSrc),
  'clientIpFrom が XFF の先頭を採っている。閲覧者がヘッダを1つ足すだけで回避できる',
);

must(
  'X-Forwarded-For の末尾をそのまま採っていない',
  !/parts\s*\[\s*parts\.length\s*-\s*1\s*\]/.test(libSrc),
  '末尾は CloudFront のオリジン向け IP で、リクエストごとに変わる。' +
    'これを採ると制限が一切効かないうえ rate_limits の行が無限に増える（2026-09-07 に本番で発生）',
);

must(
  '信頼できる前段ホップ数が定数として明示されている',
  /TRUSTED_PROXY_HOPS/.test(libSrc) &&
    /parts\.length\s*-\s*1\s*-\s*TRUSTED_PROXY_HOPS/.test(libSrc),
  'TRUSTED_PROXY_HOPS を使って位置を決めていない。' +
    '前段の構成が変わったときにどこを直すべきかが分からなくなる',
);

// ── 4. DB が使えないときに素通りしないこと（fail closed）──────────
must(
  '計上に失敗したら拒否する（fail closed）',
  /catch[\s\S]{0,200}?return\s+UNAVAILABLE\s*\(/.test(libSrc),
  'consume の失敗時に null を返している。DB が不調な間だけ制限が消える。' +
    '8625022（fail closed）・§10-1（許可リスト方式）と同じ判断にすること',
);

// ── 5. 未認証で POST を受けるルートが漏れなく通っていること ────────
//
// 除外は「レート制限より強い関門を、そのルート自身が持っている」場合のみ。
// 増やすときは理由をここに書くこと。書けないなら除外してはいけない。
const EXEMPT = {
  'src/app/api/billing/stripe/webhook/route.ts':
    'Stripe の署名検証があり、署名を作れない相手は到達できない',
  'src/app/api/cron/corpus-harvest/route.ts':
    'CORPUS_CRON_KEY の共有鍵が必須。未設定なら 500 で停止する（フェイルクローズ）',
  'src/app/api/public/report/[token]/route.ts':
    '192bit の能力トークン方式。総当たりは現実的でなく、対象もトークンで引いた行に限定される',
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

const missing = [];
const staleExempt = new Set(Object.keys(EXEMPT));
for (const file of walk('src/app/api')) {
  const src = readFileSync(file, 'utf8');
  if (!/export\s+async\s+function\s+POST/.test(src)) continue;
  // 認証を要求しているルートは対象外（認証そのものが関門になっている）
  if (/getServerSession/.test(src)) continue;
  const key = file.split('\\').join('/');
  if (EXEMPT[key]) { staleExempt.delete(key); continue; }
  if (!/enforceRateLimit\s*\(/.test(src)) missing.push(key);
}

must(
  '未認証で POST を受けるルートが全てレート制限を通っている',
  missing.length === 0,
  '次のルートが素通りしている:\n         ' + missing.join('\n         ') +
    '\n       enforceRateLimit を通すか、EXEMPT に理由つきで載せること',
);

must(
  '除外リストに実在しないパスが残っていない',
  staleExempt.size === 0,
  '次の除外はもう存在しないか、認証つきに変わっている。消すこと:\n         ' +
    [...staleExempt].join('\n         '),
);

// ── 6. contact の自動返信がリクエスト本文をエコーしていないこと ────
const CONTACT = 'src/app/api/contact/route.ts';
const contactSrc = existsSync(CONTACT) ? readFileSync(CONTACT, 'utf8') : '';
const replyBlock = contactSrc.match(/const\s+replyText\s*=\s*`([\s\S]*?)`/);
must(
  'contact の自動返信に本文の値が埋め込まれていない',
  !!replyBlock && !/\$\{/.test(replyBlock[1]),
  '自動返信の文面に ${...} での埋め込みがある。宛先も文面もリクエスト本文から来るため、' +
    '任意の文面を任意の宛先へ自社ドメインから送れる（フィッシングの踏み台）。' +
    'レート制限では回数しか減らせないので、埋め込みそのものを外すこと。' +
    '控えが要るなら送信後の画面に出す',
);

must(
  'contact の本文に長さの上限がある',
  /body:[\s\S]{0,200}?\.max\(/.test(contactSrc),
  'body に max が無い。メール本文が無制限に膨らむ',
);

console.log(`\ncheck:ratelimit — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
