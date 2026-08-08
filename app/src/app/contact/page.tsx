import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Coe 専用のお問い合わせフォームは廃止し、
 * Ordo コーポレートサイトのお問い合わせフォームに統合した。
 * ?service=coe を付けることで、フォームの対象サービスに
 * Coe が自動でチェックされる。
 */
const ORDO_CONTACT_URL =
  "https://main.d1mi97peszaux0.amplifyapp.com/?service=coe#contact";

export default function ContactPage() {
  redirect(ORDO_CONTACT_URL);
}
