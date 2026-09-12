export const dynamic = 'force-dynamic'

import { NextResponse } from "next/server";

/**
 * アカウントの削除 — **2026-09-12 に閉鎖**
 *
 * `DELETE FROM user_roles` に続けて Cognito の AdminDeleteUser を呼んでいた。
 * Ordo ID は **Libera・Coe・Akoya・組織管理者ページで共通のアカウント**なので、
 * Coe の設定画面から「DELETE」と打つだけで、その人が全サービスから締め出される。
 * さらに Ordo 台帳の MemberCode.ordoSub は残るため、台帳の紐づけが宙に浮く。
 *
 * 組織が契約して招待したアカウントを利用者本人が消せるのは、権限の設計としても逆。
 * 退職処理は組織管理者が台帳で行い、そこから各サービスの利用が止まる。
 *
 * ⚠ 再び開けるなら、消す対象を **Coe の user_roles / user_identities だけ**にすること。
 *   共有プールの Cognito ユーザーを1サービスから消してはいけない。
 */
export async function DELETE() {
  return NextResponse.json(
    {
      data: null,
      error:
        "Ordo ID は複数のサービスで共通のため、Coe から削除することはできません。所属組織のご担当者にご依頼ください。",
    },
    { status: 410 },
  );
}
