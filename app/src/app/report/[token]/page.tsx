export const dynamic = "force-dynamic";

import ReportFormClient from "./ReportFormClient";

/**
 * 実績報告の公開回答フォーム（S2 C①）
 * 認証不要・トークンURL方式（回答者に委託事業者・外部関係者を含むため — 確認結果5）。
 * データの取得・保存は /api/public/report/[token] が行う。
 */
export default function PublicReportPage({ params }: { params: { token: string } }) {
  return <ReportFormClient token={params.token} />;
}
