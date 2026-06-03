import Link from "next/link";

const LAST_UPDATED = "2026年5月1日";

const sectionHead = (
  <h2 className="text-lg font-bold text-slate-100 mb-3 pb-2 border-b" style={{ borderColor: "var(--border)" }}>
    dummy
  </h2>
);
void sectionHead;

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

export default function TermsPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-primary)" }}>
      <header className="border-b" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight bg-clip-text text-transparent neu-button-primary"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
            Sinap-sys
          </Link>
          <div className="flex gap-4 text-sm">
            <Link href="/pricing" className="text-slate-500 hover:text-slate-300 transition-colors duration-200">料金プラン</Link>
            <Link href="/contact" className="text-slate-500 hover:text-slate-300 transition-colors duration-200">お問い合わせ</Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-slate-100 mb-2">利用規約</h1>
        <p className="text-sm text-slate-600 mb-12">最終更新: {LAST_UPDATED}</p>

        <div className="space-y-10 text-slate-300 leading-relaxed text-sm">

          <Section title="第1条（適用）">
            <p>本利用規約（以下「本規約」）は、株式会社 Ordo（以下「当社」）が提供するAI政策管理SaaS「Sinap-sys」（以下「本サービス」）の利用に関する条件を定めるものです。利用者が本サービスに登録することをもって、本規約に同意したものとみなします。</p>
          </Section>

          <Section title="第2条（定義）">
            <ul className="list-disc pl-5 space-y-1.5">
              <li>「本サービス」とは、当社が提供するAI政策管理SaaS「Sinap-sys」をいいます。</li>
              <li>「利用者」とは、本サービスを利用するために登録した自治体・法人・個人をいいます。</li>
              <li>「コンテンツ」とは、利用者が本サービスに登録・入力したデータ、文書、KPI等の情報をいいます。</li>
              <li>「プラン」とは、Free・Standard・Premiumの各利用プランをいいます。</li>
            </ul>
          </Section>

          <Section title="第3条（サービスの内容）">
            <p className="mb-3">本サービスは以下の機能を提供します。</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>AI（Claude API）を活用した政策ロジックモデルの自動生成</li>
              <li>PDCAサイクルに基づく政策管理・KPI管理</li>
              <li>EBPMスコアリングおよび改善提案機能</li>
              <li>計画テンプレートの共有機能</li>
              <li>KPI報告ワークフローおよび承認機能</li>
              <li>その他当社が定める機能</li>
            </ul>
            <p className="mt-3">本サービスの機能は利用プランによって異なります。各プランの内容は
              <Link href="/pricing" className="text-indigo-400 hover:text-indigo-300 underline mx-1">料金ページ</Link>
              をご参照ください。</p>
          </Section>

          <Section title="第4条（利用登録）">
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>登録希望者は、本規約に同意の上、当社の定める方法により利用登録を申請するものとします。</li>
              <li>当社は、以下の場合に利用登録を拒否することがあります。
                <ul className="list-disc pl-5 mt-1.5 space-y-1">
                  <li>登録申請に虚偽の情報が含まれる場合</li>
                  <li>過去に本規約違反により利用停止となった者からの申請の場合</li>
                  <li>その他当社が利用登録を不適当と判断した場合</li>
                </ul>
              </li>
              <li>利用者は、登録情報に変更が生じた場合、速やかに更新するものとします。</li>
            </ol>
          </Section>

          <Section title="第5条（料金・支払い）">
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>Freeプランは登録日から30日間無料でご利用いただけます。</li>
              <li>StandardプランおよびPremiumプランの利用料金は月額制とし、料金ページに掲載の金額（消費税別）とします。</li>
              <li>カード払いの場合、毎月の契約更新日にStripeを通じて自動決済されます。</li>
              <li>請求書払いの場合、当社が発行する請求書の支払期限までにお支払いいただくものとします。</li>
              <li>支払期限を超過した場合、本サービスの利用を一時停止することがあります。</li>
              <li>一度支払いが完了した料金は、原則として返金いたしません。</li>
            </ol>
          </Section>

          <Section title="第6条（禁止事項）">
            <p className="mb-3">利用者は以下の行為を行ってはなりません。</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>法令または公序良俗に違反する行為</li>
              <li>本サービスの運営を妨害する行為（大量アクセス・不正なAPI呼び出し等）</li>
              <li>他の利用者または第三者の権利・プライバシーを侵害する行為</li>
              <li>本サービスを通じて取得した情報を無断で商業利用する行為</li>
              <li>不正アクセス・リバースエンジニアリング等</li>
              <li>その他当社が不適切と判断する行為</li>
            </ul>
          </Section>

          <Section title="第7条（免責事項）">
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>本サービスが提供するAI生成コンテンツ（ロジックモデル・改善提案等）は参考情報であり、政策判断の最終責任は利用者にあります。</li>
              <li>当社は、本サービスの利用により生じた損害について、当社の故意または重過失がある場合を除き、責任を負いません。</li>
              <li>本サービスの提供に際して、外部サービス（AWS・Stripe・Anthropic Claude等）の障害による影響については責任を負いません。</li>
            </ol>
          </Section>

          <Section title="第8条（個人情報の取扱い）">
            <p>当社は、利用者の個人情報を
              <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300 underline mx-1">プライバシーポリシー</Link>
              に従い適切に取り扱います。</p>
          </Section>

          <Section title="第9条（サービスの変更・停止）">
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>当社は、利用者への事前通知なしに本サービスの内容を変更することがあります。</li>
              <li>当社は、システムメンテナンス・緊急対応等の理由により、本サービスを一時停止することがあります。</li>
              <li>本サービスを終了する場合は、原則として30日前までに利用者に通知します。</li>
            </ol>
          </Section>

          <Section title="第10条（準拠法・管轄裁判所）">
            <p>本規約の解釈は日本法に準拠します。本規約に関する一切の紛争については、熊本地方裁判所を第一審の専属的合意管轄裁判所とします。</p>
          </Section>

          <div className="pt-8 border-t space-y-1 text-sm text-slate-500" style={{ borderColor: "var(--border)" }}>
            <p className="font-semibold text-slate-400 mb-2">事業者情報</p>
            <p>会社名: 株式会社 Ordo</p>
            <p>法人番号: 3300-01-029524</p>
            <p>代表者: 代表取締役 田上 一子</p>
            <p>所在地: 熊本県上益城郡御船町上野1652番地1</p>
            <p>お問い合わせ:
              <Link href="/contact" className="text-indigo-400 hover:text-indigo-300 underline ml-1">
                お問い合わせフォーム
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
