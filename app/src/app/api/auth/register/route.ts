export const dynamic = 'force-dynamic'

import { NextResponse } from "next/server";

/**
 * 公開の自己登録エンドポイント — **2026-09-12 に閉鎖**
 *
 * ■ なぜ閉じたか
 * Coe は完全有償化した BtoB サービスで、導入は「契約 → Ordo が組織を作成 →
 * 管理者を Ordo ID で招待」の1本に統一した（claude/coe-provisioning.md）。
 * 自己登録はこの方針と正面から矛盾するうえ、そもそも成立していなかった:
 *
 *   1. user_roles は作るが **user_identities を作っていなかった**。権限解決は
 *      user_identities を sub で引く経路に一本化されている（2026-09-06）ため、
 *      登録直後にログインしても fail closed で弾かれる。つまり作られた
 *      アカウントは最初から使えなかった。
 *   2. subscriptions に plan='free' / status='trialing' を入れて「30日トライアル」
 *      としていたが、plan が 'free' なので (admin)/layout.tsx が初日から
 *      /subscribe-required へ飛ばす。トライアルは何も与えていなかった。
 *   3. Ordo 台帳の外に Cognito ユーザーと自治体テナントが増え続ける。
 *      MemberCode が無いので /api/directory/resolve は永久に found:false を返す。
 *
 * ■ 再び開けるなら
 * 上の3つを同時に直す必要がある。特に 1 は、ここで user_identities を作らない限り
 * 「登録できたのに何も見えない」という分かりにくい形で失敗する。
 * テナント乗っ取り対策（未認証で既存自治体に合流させない・WHERE NOT EXISTS・
 * レート制限）も併せて復元すること。経緯は git log で 097a0dc / この閉鎖コミットを参照。
 */
export async function POST() {
  return NextResponse.json(
    {
      data: null,
      error:
        "アカウントの自己登録は受け付けていません。ご利用のお申し込みはお問い合わせフォームからご連絡ください。",
    },
    { status: 410 },
  );
}
