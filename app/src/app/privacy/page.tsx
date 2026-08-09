import Link from "next/link";

const LAST_UPDATED = "2026年5月1日";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-slate-100 mb-3 pb-2 border-b" style={{ borderColor: "var(--border)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
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

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-slate-100 mb-2">プライバシーポリシー</h1>
        <p className="text-sm text-slate-600 mb-12">最終更新: {LAST_UPDATED}</p>

        <div className="space-y-10 text-slate-300 leading-relaxed text-sm">

          <Section title="取得する情報">
            <p className="mb-3">当社では以下の情報を取得します。</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong className="text-slate-200">アカウント情報:</strong> メールアドレス、担当者名、自治体名・組織名</li>
              <li><strong className="text-slate-200">利用データ:</strong> 計画情報、KPI、投稿内容、アップロードファイル等、サービス内に入力されたすべてのデータ</li>
              <li><strong className="text-slate-200">決済情報:</strong> クレジットカード情報（Stripeが保管し、当社は保持しません）、請求書払いの場合は住所・インボイス番号</li>
              <li><strong className="text-slate-200">アクセスログ:</strong> IPアドレス、ブラウザ情報、アクセス日時、操作ログ</li>
              <li><strong className="text-slate-200">お問い合わせ情報:</strong> お問い合わせフォームに入力された組織名・氏名・メールアドレス・内容</li>
              <li><strong className="text-slate-200">Cookie情報:</strong> セッション管理のためのCookie</li>
            </ul>
          </Section>

          <Section title="利用目的">
            <ul className="list-disc pl-5 space-y-2">
              <li>本サービスの提供・運営・改善</li>
              <li>利用者のサポート対応・お問い合わせへの返信</li>
              <li>請求・決済処理</li>
              <li>不正利用の検知・防止</li>
              <li>本サービスに関するお知らせ・マーケティングメール（拒否可能）</li>
              <li>統計データの作成（個人を特定しない形式）</li>
            </ul>
          </Section>

          <Section title="第三者提供">
            <p className="mb-3">当社は以下の場合を除き、個人情報を第三者に提供しません。</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>利用者本人の同意がある場合</li>
              <li>法令に基づく場合</li>
              <li>業務委託先への提供（下記参照）</li>
            </ul>
            <p className="mt-3">当社が利用する主な業務委託先は以下のとおりです。</p>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: "var(--bg-input)" }}>
                    <th className="text-left px-3 py-2 border text-slate-400" style={{ borderColor: "var(--border)" }}>企業名</th>
                    <th className="text-left px-3 py-2 border text-slate-400" style={{ borderColor: "var(--border)" }}>目的</th>
                    <th className="text-left px-3 py-2 border text-slate-400" style={{ borderColor: "var(--border)" }}>所在</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Amazon Web Services, Inc.", "クラウドインフラ・認証・ストレージ", "米国"],
                    ["Stripe, Inc.", "決済処理", "米国"],
                    ["Anthropic PBC", "AI生成機能（Claude API）", "米国"],
                  ].map(([name, purpose, country]) => (
                    <tr key={name}>
                      <td className="px-3 py-2 border text-slate-300" style={{ borderColor: "var(--border)" }}>{name}</td>
                      <td className="px-3 py-2 border text-slate-400" style={{ borderColor: "var(--border)" }}>{purpose}</td>
                      <td className="px-3 py-2 border text-slate-400" style={{ borderColor: "var(--border)" }}>{country}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="安全管理措置">
            <ul className="list-disc pl-5 space-y-2">
              <li>通信はTLS（HTTPS）で暗号化します。</li>
              <li>データはAWS上で保管し、アクセス制御・暗号化を実施しています。</li>
              <li>パスワードはAmazon Cognitoにより安全に管理されています（当社はパスワードを保管しません）。</li>
              <li>定期的なセキュリティレビューを実施しています。</li>
            </ul>
          </Section>

          <Section title="開示・訂正・削除">
            <p>利用者は、自己の個人情報の開示・訂正・削除を当社に請求できます。請求は下記お問い合わせ窓口からご連絡ください。合理的な期間内（3営業日以内を目安）に対応します。なお、アカウント削除後30日間はデータのエクスポートが可能です。</p>
          </Section>

          <Section title="Cookie・アクセス解析">
            <p className="mb-3">当社はセッション管理のためCookieを使用しています。Cookieを無効にすると一部機能が利用できなくなる場合があります。</p>
            <p>現時点でGoogle Analytics等の外部アクセス解析ツールは使用していません。</p>
          </Section>

          <Section title="お問い合わせ窓口">
            <div className="rounded-xl border p-5 space-y-1.5" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
              <p className="font-semibold text-slate-300 mb-2">個人情報管理者</p>
              <p>会社名: 株式会社 Ordo</p>
              <p>個人情報管理者: 代表取締役 田上 一子</p>
              <p>所在地: 熊本県上益城郡御船町上野1652番地1</p>
              <p className="mt-2">
                お問い合わせ:
                <Link href="/contact" className="text-indigo-400 hover:text-indigo-300 underline ml-1">
                  お問い合わせフォーム（/contact）
                </Link>
              </p>
              <p className="text-slate-500 text-xs mt-2">お問い合わせには3営業日以内にご返信いたします。</p>
            </div>
          </Section>

          <div className="pt-8 border-t text-xs text-slate-600" style={{ borderColor: "var(--border)" }}>
            <p>本プライバシーポリシーは予告なく変更される場合があります。重要な変更がある場合は、サービス内またはメールにてお知らせします。</p>
          </div>
        </div>
      </main>
    </div>
  );
}
