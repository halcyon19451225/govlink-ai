import Link from "next/link";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr className="border-b" style={{ borderColor: "var(--border)" }}>
      <td className="py-3 pr-6 text-slate-400 whitespace-nowrap align-top" style={{ width: "200px" }}>{label}</td>
      <td className="py-3 text-slate-300 leading-relaxed">{value}</td>
    </tr>
  );
}

export default function LegalPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-primary)" }}>
      <header className="border-b" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="neu-button-wrap">
            <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-coe.svg" alt="Coe" style={{ height: 44, width: "auto" }} />
          </Link>
          </div>
          <div className="flex gap-4 text-sm">
            <Link href="/terms" className="text-slate-500 hover:text-slate-300 transition-colors duration-200">利用規約</Link>
            <Link href="/contact" className="text-slate-500 hover:text-slate-300 transition-colors duration-200">お問い合わせ</Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16 flex-1">
        <h1 className="text-3xl font-bold text-slate-100 mb-2">特定商取引法に基づく表記</h1>
        <p className="text-sm text-slate-600 mb-12">特定商取引法第11条に基づく表示</p>

        <div className="rounded-2xl border overflow-hidden text-sm" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <table className="w-full">
            <tbody>
              <Row label="販売業者" value="株式会社 Ordo" />
              <Row label="法人番号" value="3300-01-029524" />
              <Row label="代表者" value="代表取締役 田上 一子" />
              <Row
                label="所在地"
                value="熊本県上益城郡御船町上野1652番地1"
              />
              <Row
                label="お問い合わせ"
                value={
                  <>
                    <Link href="/contact" className="text-indigo-400 hover:text-indigo-300 underline">
                      お問い合わせフォーム
                    </Link>
                    <span className="text-slate-500 text-xs block mt-1">
                      ※ 電話番号・メールアドレスは非公開です。お問い合わせフォームよりご連絡ください。
                    </span>
                  </>
                }
              />
              <Row
                label="販売価格"
                value={
                  <>
                    各プランページをご参照ください。
                    <Link href="/pricing" className="text-indigo-400 hover:text-indigo-300 underline ml-1">
                      料金プランを見る →
                    </Link>
                    <span className="text-slate-500 text-xs block mt-1">※ 価格は税抜き表示。消費税（10%）が別途加算されます。</span>
                  </>
                }
              />
              <Row
                label="支払方法"
                value={
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>クレジットカード（Visa / Mastercard / American Express / JCB）</li>
                    <li>請求書払い（StandardプランおよびPremiumプランのみ）</li>
                  </ul>
                }
              />
              <Row
                label="支払時期"
                value={
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>カード払い: 毎月の契約更新日に自動決済</li>
                    <li>請求書払い: 請求書に記載の支払期限まで（月次・前払い）</li>
                  </ul>
                }
              />
              <Row
                label="サービス提供時期"
                value="決済完了後、即時ご利用いただけます。請求書払いの場合はご入金確認後に有効化します。"
              />
              <Row
                label="返品・キャンセル"
                value={
                  <>
                    サービスの性質上、決済完了後の返金は原則承っておりません。
                    <br />
                    詳細は
                    <Link href="/terms" className="text-indigo-400 hover:text-indigo-300 underline mx-1">
                      利用規約 第5条
                    </Link>
                    をご参照ください。
                  </>
                }
              />
              <Row
                label="動作環境"
                value="モダンブラウザ（Google Chrome / Safari / Mozilla Firefox / Microsoft Edge）の最新版推奨"
              />
              <Row
                label="適格請求書"
                value={
                  <span className="text-amber-400">
                    ※ 適格請求書発行事業者登録申請中。登録完了後に改めてご案内いたします。
                  </span>
                }
              />
            </tbody>
          </table>
        </div>

        <div className="mt-8 rounded-xl border p-4 text-xs text-slate-500 space-y-1" style={{ borderColor: "var(--border)" }}>
          <p>ご不明な点はお問い合わせフォームよりお問い合わせください。3営業日以内にご返信いたします。</p>
          <Link href="/contact" className="text-indigo-400 hover:text-indigo-300 underline">
            お問い合わせフォームへ →
          </Link>
        </div>
      </main>

    </div>
  );
}
