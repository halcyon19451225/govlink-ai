import Link from "next/link";

export const metadata = { title: "アカウントの作成について | Coe" };

/**
 * 自己登録の廃止案内（2026-09-12）。
 *
 * 以前はここにアカウント作成フォームがあったが、Coe の導入は
 * 「契約 → Ordo が組織を作成 → 管理者を Ordo ID で招待」の1本に統一した。
 * 経緯と、再び開ける場合の条件は src/app/api/auth/register/route.ts のコメントに残してある。
 *
 * リンクや検索から辿り着く人がいるので、リダイレクトではなく案内を出す。
 * 「無くなった」ことより「ではどうすればよいか」が分かることが大事。
 */
export default function RegisterClosedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: "var(--bg-primary)" }}>
      <div className="w-full max-w-xl">
        <div className="rounded-2xl border p-8" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-coe.svg" alt="Coe" style={{ height: 44, width: "auto", marginBottom: 16 }} />

          <h1 className="text-xl font-bold mb-3" style={{ color: "var(--text-primary)" }}>
            アカウントの自己登録は行っていません
          </h1>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Coe は組織単位でご契約いただくサービスです。アカウントは、ご契約後に組織の管理者が発行し、
            お一人ずつ招待する仕組みになっています。
          </p>

          <div className="rounded-xl border p-5 mb-6" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>ご利用開始までの流れ</p>
            <ol className="text-sm space-y-2 list-decimal list-inside leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              <li>お問い合わせいただき、ご契約内容を決めます</li>
              <li>こちらで組織を登録し、ご担当者に招待メールをお送りします</li>
              <li>届いたメールの仮パスワードでログインし、ご自身のパスワードを設定します</li>
              <li>以後は組織の管理者が、利用者の追加・変更を行えます</li>
            </ol>
          </div>

          <div className="flex gap-3 flex-wrap">
            <Link
              href="/contact"
              className="text-sm font-semibold text-white px-5 py-2.5 rounded-xl transition-all duration-200 hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
            >
              お問い合わせ
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-semibold px-5 py-2.5 rounded-xl border transition-all duration-200 hover:bg-white/5"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              料金プランを見る
            </Link>
          </div>

          <p className="text-xs mt-6" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
            すでに招待を受けている方は <Link href="/login" className="text-cyan-400 hover:text-cyan-300">ログイン</Link> からお進みください。
            招待メールが見当たらない場合は、組織のご担当者にご確認ください。
          </p>
        </div>
      </div>
    </div>
  );
}
