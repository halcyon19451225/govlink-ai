"use client";

// 次期計画への引き継ぎ
//
// PDCA が実際に一周するのはこの一点。計画期間評価（図7）の判断経路、
// 次期に送る改善アクション、未達の中間・長期アウトカム、到達した真因を
// ひとまとまりにして固定し、次期計画へ渡す。

import { useEffect, useState } from "react";
import AiThinkingIndicator from "@/components/AiThinkingIndicator";
import CloneNextPeriodButton from "@/components/plan/CloneNextPeriodButton";
import { OUTCOME_TIER_META, type OutcomeTier } from "@/lib/outcome/tiers";

interface HandoverPackage {
  generated_at: string;
  carry_over_actions: {
    id: string;
    title: string;
    detail: string | null;
    root_cause: string | null;
    status: string;
    owner_department: string | null;
    due_date: string | null;
  }[];
  unmet_outcomes: {
    kpi_id: string;
    label: string;
    tier: string;
    unit: string;
    baseline: number | null;
    current: number | null;
    target: number | null;
    rate: number | null;
    deadline: string | null;
  }[];
  flow_decisions: {
    evaluation_id: string;
    flow: string;
    fiscal_year: number | null;
    decisions: { question: string; answer: string; note?: string }[];
  }[];
  root_causes: { title: string; root_cause: string | null }[];
  notes: string;
}

interface HandoverRow {
  id: string;
  title: string;
  fiscal_year: number | null;
  target_project_id: string | null;
  target_project_title: string | null;
  package: HandoverPackage;
  status: "draft" | "finalized" | "consumed";
  finalized_at: string | null;
  consumed_at: string | null;
  created_at: string;
}

interface Props {
  projectId: string;
  otherProjects: { id: string; title: string }[];
}

const cardStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  borderColor: "var(--border)",
};
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  borderColor: "var(--border)",
};

const STATUS_STYLE: Record<HandoverRow["status"], { label: string; color: string }> = {
  draft: { label: "下書き", color: "#f59e0b" },
  finalized: { label: "確定", color: "#10b981" },
  consumed: { label: "次期計画が取込済", color: "#818cf8" },
};

function tierLabel(t: string): string {
  return OUTCOME_TIER_META[t as OutcomeTier]?.label ?? t;
}

function PackageView({ pkg }: { pkg: HandoverPackage }) {
  const section = (title: string, count: number, body: React.ReactNode) => (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-xs font-bold text-slate-300">{title}</h4>
        <span className="text-[10px] text-slate-500">{count}件</span>
        <span className="flex-1 h-px" style={{ background: "var(--border)" }} />
      </div>
      {count === 0 ? <p className="text-[11px] text-slate-600">該当なし</p> : body}
    </div>
  );

  return (
    <div className="space-y-5">
      {section(
        "① 未達のアウトカム",
        pkg.unmet_outcomes.length,
        <ul className="space-y-1.5">
          {pkg.unmet_outcomes.map((o) => (
            <li key={o.kpi_id} className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-slate-300 truncate">
                <span className="text-slate-500">[{tierLabel(o.tier)}]</span> {o.label}
              </span>
              <span className="text-[11px] tabular-nums shrink-0 text-slate-400">
                {o.current ?? "—"}
                {o.unit} / 目標 {o.target ?? "—"}
                {o.unit}
                <span className="ml-2" style={{ color: (o.rate ?? 0) < 0 ? "#ef4444" : "#f59e0b" }}>
                  到達度 {o.rate == null ? "—" : `${o.rate}%`}
                </span>
              </span>
            </li>
          ))}
        </ul>,
      )}

      {section(
        "② 次期へ送る改善アクション",
        pkg.carry_over_actions.length,
        <ul className="space-y-1.5">
          {pkg.carry_over_actions.map((a) => (
            <li key={a.id} className="text-[11px] text-slate-300 leading-snug">
              ・{a.title}
              <span className="text-slate-500">
                {a.owner_department ? `（${a.owner_department}` : ""}
                {a.due_date ? `${a.owner_department ? " / " : "（"}期限 ${a.due_date}` : ""}
                {a.owner_department || a.due_date ? "）" : ""}
              </span>
              {a.root_cause && (
                <span className="block text-[10px] text-slate-500 ml-3">真因: {a.root_cause}</span>
              )}
            </li>
          ))}
        </ul>,
      )}

      {section(
        "③ 評価フローの判断経路",
        pkg.flow_decisions.length,
        <ul className="space-y-2.5">
          {pkg.flow_decisions.map((f) => (
            <li key={f.evaluation_id}>
              <p className="text-[11px] font-semibold text-slate-300">
                {f.flow}
                {f.fiscal_year ? `（${f.fiscal_year}年度）` : ""}
              </p>
              <ul className="ml-3 mt-0.5 space-y-0.5">
                {f.decisions.map((d, i) => (
                  <li key={i} className="text-[10px] text-slate-400 leading-snug">
                    {d.question} → <span className="text-slate-200">{d.answer}</span>
                    {d.note && <span className="block text-slate-500">{d.note}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>,
      )}

      {section(
        "④ 到達した真因",
        pkg.root_causes.length,
        <ul className="space-y-1">
          {pkg.root_causes.map((r, i) => (
            <li key={i} className="text-[11px] text-slate-300 leading-snug">
              ・<span className="text-slate-200">{r.title}</span>: {r.root_cause}
            </li>
          ))}
        </ul>,
      )}

      {pkg.notes && (
        <div>
          <h4 className="text-xs font-bold text-slate-300 mb-1">申し送り</h4>
          <p className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">{pkg.notes}</p>
        </div>
      )}
    </div>
  );
}

export default function HandoverPanel({ projectId, otherProjects }: Props) {
  const [rows, setRows] = useState<HandoverRow[]>([]);
  const [preview, setPreview] = useState<HandoverPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [listRes, prevRes] = await Promise.all([
        fetch(`/api/admin/projects/${projectId}/handover`),
        fetch(`/api/admin/projects/${projectId}/handover?preview=true`),
      ]);
      const listJson = (await listRes.json()) as { data: HandoverRow[] | null };
      const prevJson = (await prevRes.json()) as { data: { preview: HandoverPackage } | null };
      setRows(listJson.data ?? []);
      setPreview(prevJson.data?.preview ?? null);
    } catch {
      setError("読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const create = async (finalize: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || null, finalize }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "作成に失敗しました");
        return;
      }
      setNotes("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/handover/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error: string | null };
      if (!res.ok) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border p-8 flex justify-center" style={cardStyle}>
        <AiThinkingIndicator label="引き継ぎ内容を集計しています" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* PL1 P①: 次期計画のたたき台作成（複製）。finalized な引き継ぎは複製時に自動で結線される */}
      <div className="flex justify-end">
        <CloneNextPeriodButton projectId={projectId} />
      </div>
      {error && (
        <div
          className="rounded-lg border px-4 py-2 text-sm"
          style={{ borderColor: "#ef444460", background: "#ef444410", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {/* いま引き継ぐとどうなるか */}
      <div className="rounded-2xl border p-5" style={cardStyle}>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">
          いま引き継ぐ内容（プレビュー）
        </h3>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          計画期間評価が終わったら、この内容を確定して次期計画へ渡します。
          確定すると<strong className="text-slate-300">その時点で内容が固定</strong>され、以後もとのデータが変わっても引き継ぎ内容は動きません。
        </p>

        {preview ? (
          <PackageView pkg={preview} />
        ) : (
          <p className="text-xs text-slate-500">集計できませんでした。</p>
        )}

        <div className="mt-5 pt-4 space-y-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">申し送り（任意）</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputClass}
              style={inputStyle}
              placeholder="次期計画策定委員会に伝えるべきことがあれば記入してください"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void create(true)}
              disabled={busy}
              className="text-sm font-semibold px-5 py-2 rounded-xl text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #b45309, #d97706)" }}
            >
              {busy ? "処理中..." : "この内容で確定する"}
            </button>
            <button
              type="button"
              onClick={() => void create(false)}
              disabled={busy}
              className="text-sm px-4 py-2 rounded-xl disabled:opacity-50"
              style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
            >
              下書きとして保存
            </button>
          </div>
        </div>
      </div>

      {/* 作成済み */}
      {rows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-300">作成済みの引き継ぎ</h3>
          {rows.map((h) => {
            const st = STATUS_STYLE[h.status];
            return (
              <div key={h.id} className="rounded-2xl border p-5" style={cardStyle}>
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: `${st.color}20`, color: st.color, border: `1px solid ${st.color}55` }}
                      >
                        {st.label}
                      </span>
                      <span className="text-[10px] text-slate-500">{h.created_at.slice(0, 10)}</span>
                    </div>
                    <h4 className="text-sm font-semibold text-slate-100">{h.title}</h4>
                    {h.target_project_title && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        引き継ぎ先: {h.target_project_title}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {h.status === "draft" && (
                      <>
                        <button
                          type="button"
                          onClick={() => void patch(h.id, { refresh: true })}
                          disabled={busy}
                          className="text-[11px] px-3 py-1.5 rounded-lg disabled:opacity-50"
                          style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}
                        >
                          最新データで再集計
                        </button>
                        <button
                          type="button"
                          onClick={() => void patch(h.id, { status: "finalized" })}
                          disabled={busy}
                          className="text-[11px] px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                          style={{ background: "#10b98118", color: "#10b981", border: "1px solid #10b98140" }}
                        >
                          確定する
                        </button>
                      </>
                    )}
                    {h.status === "finalized" && (
                      <button
                        type="button"
                        onClick={() => void patch(h.id, { status: "consumed" })}
                        disabled={busy}
                        className="text-[11px] px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                        style={{ background: "#6366f118", color: "#818cf8", border: "1px solid #6366f140" }}
                      >
                        取込済みにする
                      </button>
                    )}
                  </div>
                </div>

                {otherProjects.length > 0 && h.status !== "consumed" && (
                  <div className="mb-3" style={{ maxWidth: 360 }}>
                    <label className="text-[11px] text-slate-400 mb-1 block">
                      引き継ぎ先の計画
                    </label>
                    <select
                      value={h.target_project_id ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        void patch(h.id, { target_project_id: e.target.value || null })
                      }
                      className="w-full rounded-lg border px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      style={inputStyle}
                    >
                      <option value="">（未設定 — 次期計画の作成後に指定）</option>
                      {otherProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <details>
                  <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">
                    引き継ぎ内容を表示
                  </summary>
                  <div className="mt-3">
                    <PackageView pkg={h.package} />
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
