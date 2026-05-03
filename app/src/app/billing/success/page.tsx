import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0f1117" }}>
      <div className="w-full max-w-md rounded-2xl border p-10 text-center space-y-6"
        style={{ background: "#1a1d27", borderColor: "#10b98130" }}>
        <div className="flex items-center justify-center w-16 h-16 rounded-full mx-auto"
          style={{ background: "#10b98120" }}>
          <svg width={32} height={32} fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-100 mb-2">お申し込みありがとうございます</h1>
          <p className="text-sm text-slate-500">
            決済が完了しました。プランが有効になりました。
          </p>
        </div>
        <Link href="/dashboard"
          className="block text-sm font-semibold text-white py-3 rounded-xl transition-all duration-200"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
          ダッシュボードへ →
        </Link>
        <Link href="/billing" className="block text-sm text-slate-500 hover:text-slate-300 transition-colors duration-200">
          プラン・請求を確認する
        </Link>
      </div>
    </div>
  );
}
