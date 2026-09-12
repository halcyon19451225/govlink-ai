export const dynamic = 'force-dynamic'

import { NextResponse } from "next/server";

/**
 * 表示名の変更 — **2026-09-12 に閉鎖**
 *
 * user_roles.display_name を直接書き換えていたが、Coe のローカルの行を
 * 書き換えるだけで Ordo の台帳には届かない。さらに同日入れたプロビジョニングが
 * ログインのたびに台帳の氏名で display_name を上書きするため、
 * **「保存済み ✓」と出たあと、次のログインで元に戻る**という壊れ方をしていた。
 *
 * 氏名・所属・メールは Ordo の組織台帳が正本。変更は組織管理者ページで行う。
 * 本人が直したい場合は、台帳の「本人からの変更申請」を使う（組織管理者が承認する）。
 *
 * 再び開けるなら、ここで台帳へ書き戻すか申請を作るかを決めてからにすること。
 * Coe のローカルだけを更新する実装に戻してはいけない。
 */
export async function PATCH() {
  return NextResponse.json(
    {
      data: null,
      error:
        "氏名は所属組織の台帳で管理されています。変更は組織のご担当者にご依頼ください。",
    },
    { status: 410 },
  );
}
