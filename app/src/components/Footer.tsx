import Link from "next/link";

export default function Footer() {
  return (
    <footer
      className="border-t mt-auto"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-wrap gap-6 items-center justify-between text-xs" style={{ color: "#94a3b8" }}>
          <span className="font-medium">© 2022 Ordo.Inc</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/terms" className="hover:text-slate-200 transition-colors duration-200">利用規約</Link>
            <Link href="/privacy" className="hover:text-slate-200 transition-colors duration-200">プライバシーポリシー</Link>
            <Link href="/legal" className="hover:text-slate-200 transition-colors duration-200">特定商取引法に基づく表記</Link>
            <Link href="/pricing" className="hover:text-slate-200 transition-colors duration-200">料金プラン</Link>
            <Link href="/contact" className="hover:text-slate-200 transition-colors duration-200">お問い合わせ</Link>
          </div>
        </div>
        <p className="mt-3 text-xs" style={{ color: "#475569" }}>
          法人番号: 3300-01-029524
        </p>
      </div>
    </footer>
  );
}
