"use client";

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "../../../components/BackButton";
import { type Plan } from "@/lib/plan-limits";

const PLAN_LABELS: Record<Plan, string> = {
  free: "Free（試用）",
  light: "Light",
  standard: "Standard",
  premium: "Premium",
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  trialing: { label: "試用中", color: "#06b6d4", bg: "#06b6d415" },
  active:   { label: "有効",   color: "#10b981", bg: "#10b98115" },
  past_due: { label: "支払遅延", color: "#ef4444", bg: "#ef444415" },
  canceled: { label: "解約済", color: "#64748b", bg: "#64748b15" },
  paused:   { label: "停止中", color: "#f59e0b", bg: "#f59e0b15" },
};

const INV_STATUS: Record<string, { label: string; color: string }> = {
  unpaid:   { label: "未払い",  color: "#f59e0b" },
  paid:     { label: "支払済", color: "#10b981" },
  overdue:  { label: "期限超過", color: "#ef4444" },
  canceled: { label: "取消",   color: "#64748b" },
};

interface BillingData {
  plan: Plan;
  status: string;
  trialEndsAt: string | null;
  projects: { current: number; limit: number };
  users: { current: number; limit: number };
  aiCalls: { current: number; limit: number };
  billingMethod: string | null;
  cancelAtPeriodEnd: boolean;
  invoices: Array<{
    id: string;
    invoice_number: string;
    total_amount: number;
    period_start: string;
    period_end: string;
    status: string;
    created_at: string;
  }>;
}

function UsageMeter({ label, current, limit }: { label: string; current: number; limit: number }) {
  const pct = limit === Infinity ? 0 : Math.min(100, Math.round((current / limit) * 100));
  const isInfinity = limit === Infinity;
  const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#10b981";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="font-semibold text-slate-200">
          {current} / {isInfinity ? "∞" : limit}
        </span>
      </div>
      {!isInfinity && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
      )}
      {isInfinity && (
        <div className="h-1.5 rounded-full" style={{ background: "linear-gradient(90deg, #10b981, #06b6d4)" }} />
      )}
    </div>
  );
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch("/api/billing/status")
      .then((r) => r.json())
      .then((j: { data: BillingData | null }) => { if (j.data) setData(j.data); })
      .finally(() => setLoading(false));
  }, []);

  const handleStripePortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/stripe/portal", { method: "POST" });
      const json = (await res.json()) as { data: { url: string } | null; error: string | null };
      if (json.data?.url) window.location.href = json.data.url;
      else alert(json.error ?? "エラーが発生しました");
    } finally {
      setPortalLoading(false);
    }
  };

  const trialDaysLeft = data?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  const cardStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-2xl font-bold tracking-tight bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            プラン・請求
          </h2>
          <p className="text-sm text-slate-500 mt-1">現在の利用状況と請求履歴を確認します。</p>
        </div>
        <div className="neu-button-wrap">
          <Link href="/pricing"
          className="text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all duration-200 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}>
          プランを変更する
        </Link>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-500 text-sm">読み込み中...</div>
      ) : data ? (
        <>
          {/* Plan status */}
          <div className="rounded-2xl border p-6" style={cardStyle}>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-xl font-bold text-slate-100">{PLAN_LABELS[data.plan]}</h3>
                  {STATUS_LABELS[data.status] && (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        background: STATUS_LABELS[data.status]!.bg,
                        color: STATUS_LABELS[data.status]!.color,
                      }}
                    >
                      {STATUS_LABELS[data.status]!.label}
                    </span>
                  )}
                </div>
                {data.status === "trialing" && trialDaysLeft !== null && (
                  <p className="text-sm text-slate-500">
                    試用期間残り <span className="text-cyan-400 font-semibold">{trialDaysLeft}日</span>
                    {trialDaysLeft <= 7 && <span className="text-amber-400 ml-2 text-xs">まもなく終了</span>}
                  </p>
                )}
                {data.cancelAtPeriodEnd && (
                  <p className="text-sm text-amber-400 mt-1">期間終了時に解約されます</p>
                )}
              </div>
              <div className="flex gap-2">
                {data.billingMethod === "stripe" && (
                  <button
                    onClick={() => void handleStripePortal()}
                    disabled={portalLoading}
                    className="text-xs text-slate-400 hover:text-slate-200 border rounded-lg px-3 py-2 transition-colors duration-200 disabled:opacity-50"
                    style={{ borderColor: "var(--border)" }}
                  >
                    {portalLoading ? "..." : "支払い方法・解約の管理"}
                  </button>
                )}
              </div>
            </div>

            {/* Usage meters */}
            <div className="space-y-4">
              <UsageMeter label="計画数" current={data.projects.current} limit={data.projects.limit} />
              <UsageMeter label="ユーザー数" current={data.users.current} limit={data.users.limit} />
              <UsageMeter
                label={`AI生成回数（今月）`}
                current={data.aiCalls.current}
                limit={data.aiCalls.limit}
              />
            </div>
          </div>

          {/* Feature comparison */}
          {data.plan === "free" && (
            <div className="rounded-2xl border p-5" style={{ ...cardStyle, borderColor: "#f59e0b30" }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-amber-400 text-xl">⚡</span>
                <span className="text-sm font-semibold text-slate-200">Standard/Premiumプランで解放される機能</span>
              </div>
              <ul className="grid sm:grid-cols-2 gap-2 text-sm text-slate-400">
                {["計画10件以上", "ユーザー10名以上", "AI生成100回以上/月", "テンプレート共有", "請求書払い対応"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="text-amber-400">→</span> {f}
                  </li>
                ))}
              </ul>
              <Link href="/pricing"
                className="inline-block mt-4 text-sm font-semibold text-white px-5 py-2 rounded-xl transition-all duration-200"
                style={{ background: "linear-gradient(135deg, #f59e0b, #fbbf24)" }}>
                アップグレードする
              </Link>
            </div>
          )}

          {/* Invoice history */}
          <section>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">請求履歴</h3>
            {data.invoices.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border)" }}>
                <p className="text-sm text-slate-500">請求履歴はありません</p>
              </div>
            ) : (
              <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ background: "var(--bg-input)", borderColor: "var(--border)" }}>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">請求書番号</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">期間</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">金額</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ステータス</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {data.invoices.map((inv) => {
                      const sc = INV_STATUS[inv.status] ?? { label: inv.status, color: "#64748b" };
                      return (
                        <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors duration-200">
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">{inv.invoice_number}</td>
                          <td className="px-4 py-3 text-slate-400 hidden sm:table-cell text-xs">
                            {inv.period_start} 〜 {inv.period_end}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-200">
                            ¥{inv.total_amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-semibold" style={{ color: sc.color }}>
                              {sc.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <a
                              href={`/api/billing/invoice/${inv.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
                            >
                              PDFダウンロード
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="text-center py-16 text-slate-500 text-sm">データを読み込めませんでした</div>
      )}
    </div>
  );
}
