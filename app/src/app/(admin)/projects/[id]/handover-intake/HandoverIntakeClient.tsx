"use client";

/**
 * 前期報告書・引き継ぎの取り込み — PL1 P②
 *
 * 経路1（主経路・構造化データ）: plan_handovers.package から
 *   AIが反映差分を提案 → 担当者がチェックボックスで選別 → 一括適用。
 *   適用はすべてリネージつき（LMは改訂版・改善は source='handover'・
 *   施策は反映マーク・KPIは要見直しフラグの解除）。
 * 経路2（互換経路）: 前期がCoe外・紙運用だった場合は docx/PDF を
 *   ナレッジ（Tier1）へアップロード → 既存のナレッジ抽出フローで取り込む。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { IntakeProposal } from "@/lib/plan/handoverIntake";

interface HandoverInfo {
  id: string;
  title: string;
  status: string;
  source_project_id: string;
  source_project_title: string;
  finalized_at: string | null;
  consumed_at: string | null;
  package: {
    unmet_outcomes?: { label: string; rate: number | null; target: number | null; current: number | null; unit: string }[];
    carry_over_actions?: { title: string; status: string; root_cause: string | null }[];
    root_causes?: { title: string; root_cause: string | null }[];
    flow_decisions?: { flow: string; fiscal_year: number | null }[];
  };
}

interface MeasureRow {
  id: string;
  title: string;
}

interface KpiRow {
  id: string;
  label: string;
  unit: string;
  target: number | null;
  target_needs_review: boolean;
}

const card: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
};

const TYPE_LABEL: Record<IntakeProposal["type"], string> = {
  lm_element_edit: "🧩 ロジックモデルの修正（改訂版を起こして適用）",
  measure_update: "🛠 施策への反映（B/D区画）",
  kpi_target: "🎯 KPI目標の見直し",
  improvement_action: "🔧 改善アクションの起票（source=handover）",
};

export default function HandoverIntakeClient({ projectId }: { projectId: string }) {
  const [handover, setHandover] = useState<HandoverInfo | null>(null);
  const [measures, setMeasures] = useState<MeasureRow[]>([]);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<IntakeProposal[] | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{
    counts: { lm_edits: number; measure_updates: number; kpi_targets: number; improvement_actions: number };
    lm_version: number | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/handover-intake`);
      const json = (await res.json()) as {
        data: { handover: HandoverInfo | null; measures?: MeasureRow[]; kpis?: KpiRow[] } | null;
        error: string | null;
      };
      if (res.ok && json.data) {
        setHandover(json.data.handover);
        setMeasures(json.data.measures ?? []);
        setKpis(json.data.kpis ?? []);
      } else {
        setError(json.error ?? "読み込みに失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const measureTitle = useMemo(() => new Map(measures.map((m) => [m.id, m.title])), [measures]);
  const kpiLabel = useMemo(() => new Map(kpis.map((k) => [k.id, `${k.label}（現目標 ${k.target ?? "—"}${k.unit}）`])), [kpis]);

  const generate = async () => {
    setBusy("generate");
    setError(null);
    setProposals(null);
    setApplied(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/handover-intake/proposals`, { method: "POST" });
      const json = (await res.json()) as {
        data: { proposals: IntakeProposal[]; rejected: { reason: string }[] } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "提案の生成に失敗しました");
        return;
      }
      setProposals(json.data.proposals);
      setSelected(json.data.proposals.map(() => true));
    } catch {
      setError("通信エラーが発生しました（提案の生成には時間がかかることがあります）");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!handover || !proposals) return;
    const accepted = proposals.filter((_, i) => selected[i]);
    if (accepted.length === 0) return;
    setBusy("apply");
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/handover-intake/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handover_id: handover.id, proposals: accepted }),
      });
      const json = (await res.json()) as { data: typeof applied | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "適用に失敗しました");
        return;
      }
      setApplied(json.data);
      setProposals(null);
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: "#ef444418", color: "#f87171" }}>
          ⚠ {error}
        </p>
      )}
      {applied && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: "#10b98118", color: "#6ee7b7" }}>
          ✅ 一括適用が完了しました — LM修正{applied.counts.lm_edits}件
          {applied.lm_version != null && `（第${applied.lm_version}版として改訂）`} /
          施策反映{applied.counts.measure_updates}件 / KPI見直し{applied.counts.kpi_targets}件 /
          改善起票{applied.counts.improvement_actions}件。引き継ぎは「取り込み済み（consumed）」になりました
        </p>
      )}

      {!handover ? (
        <div className="rounded-xl p-6" style={card}>
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            この計画に結線された引き継ぎパッケージはありません
          </p>
          <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
            前期計画側の「📦 次期計画への引き継ぎ」タブでパッケージを確定（finalized）し、
            引き継ぎ先にこの計画を指定するか、前期計画から「▶ 次期計画のたたき台を作成」で
            この計画を作成すると自動で結線されます
          </p>
        </div>
      ) : (
        <>
          {/* ── パッケージの中身 ── */}
          <div className="rounded-xl p-4 space-y-3" style={card}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                📦 {handover.title} — 前期「{handover.source_project_title}」より
              </h2>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded"
                style={
                  handover.status === "consumed"
                    ? { background: "#10b98122", color: "#34d399" }
                    : { background: "#f59e0b22", color: "#fbbf24" }
                }
              >
                {handover.status === "consumed" ? `取り込み済み（${handover.consumed_at?.slice(0, 10)}）` : "取り込み待ち"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
              <div>
                <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                  未達のアウトカム（{handover.package.unmet_outcomes?.length ?? 0}件）
                </p>
                {(handover.package.unmet_outcomes ?? []).slice(0, 6).map((o, i) => (
                  <p key={i}>
                    ・{o.label}: {o.current ?? "—"}/{o.target ?? "—"}{o.unit}
                    {o.rate != null && `（達成率${Math.round(o.rate)}%）`}
                  </p>
                ))}
              </div>
              <div>
                <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                  次期へ送る改善アクション（{handover.package.carry_over_actions?.length ?? 0}件）
                </p>
                {(handover.package.carry_over_actions ?? []).slice(0, 6).map((a, i) => (
                  <p key={i}>・{a.title}（{a.status}）</p>
                ))}
              </div>
              <div>
                <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                  真因（{handover.package.root_causes?.length ?? 0}件）
                </p>
                {(handover.package.root_causes ?? []).slice(0, 4).map((r, i) => (
                  <p key={i}>・{r.title}: {r.root_cause ?? "—"}</p>
                ))}
              </div>
              <div>
                <p className="font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                  評価フローの判断経路（{handover.package.flow_decisions?.length ?? 0}件）
                </p>
                {(handover.package.flow_decisions ?? []).slice(0, 4).map((f, i) => (
                  <p key={i}>・{f.flow}{f.fiscal_year ? `（${f.fiscal_year}年度）` : ""}</p>
                ))}
              </div>
            </div>
          </div>

          {/* ── 反映プレビュー（経路1） ── */}
          {handover.status === "finalized" && (
            <div className="rounded-xl p-4 space-y-3" style={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  反映プレビュー（AIの差分提案 → 選別 → 一括適用）
                </h2>
                <button
                  onClick={() => void generate()}
                  disabled={busy != null}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                  style={{ background: "#6366f1" }}
                >
                  {busy === "generate" ? "提案を生成中…" : proposals ? "提案を作り直す" : "AIに反映案を作らせる"}
                </button>
              </div>

              {proposals && proposals.length === 0 && (
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  反映提案はありませんでした（引き継ぎ内容がすでに反映済みか、対応先が見つからない可能性）
                </p>
              )}

              {proposals && proposals.length > 0 && (
                <>
                  <div className="space-y-2">
                    {proposals.map((p, i) => (
                      <label
                        key={i}
                        className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs cursor-pointer"
                        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={selected[i] ?? false}
                          onChange={() =>
                            setSelected((prev) => prev.map((v, j) => (j === i ? !v : v)))
                          }
                        />
                        <span style={{ color: "var(--text-secondary)" }}>
                          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {TYPE_LABEL[p.type]}
                          </span>
                          <br />
                          {p.type === "lm_element_edit" && (
                            <>
                              {p.section}{p.element_id ? `（要素 ${p.element_id} を修正）` : "（要素を追加）"}: {p.new_text}
                              <br />根拠: {p.rationale}
                            </>
                          )}
                          {p.type === "measure_update" && (
                            <>
                              {measureTitle.get(p.measure_id) ?? p.measure_id} の{p.section === "experiment" ? "D区画（実験設計）" : "B区画（介入）"}へ: {p.proposal}
                              {p.from_action_title && <><br />元の改善: {p.from_action_title}</>}
                            </>
                          )}
                          {p.type === "kpi_target" && (
                            <>
                              {kpiLabel.get(p.kpi_id) ?? p.kpi_id} → {p.proposed_target != null ? `目標 ${p.proposed_target}` : "（数値提案なし・要見直しのまま）"}
                              {p.proposed_deadline && ` / 期限 ${p.proposed_deadline}`}
                              <br />根拠: {p.rationale}
                            </>
                          )}
                          {p.type === "improvement_action" && (
                            <>
                              {p.title}
                              {p.detail && <><br />{p.detail}</>}
                              {p.root_cause && <><br />真因: {p.root_cause}</>}
                            </>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void apply()}
                      disabled={busy != null || selected.every((v) => !v)}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                      style={{ background: "#10b981" }}
                    >
                      {busy === "apply" ? "適用中…" : `選択した${selected.filter(Boolean).length}件を一括適用`}
                    </button>
                    <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      適用はすべてリネージつき（LMは改訂版・改善はsource=handover・施策は反映マーク）。
                      適用後、この引き継ぎは consumed になります
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 経路2（互換経路） ── */}
          <div className="rounded-xl p-4 space-y-1" style={card}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              📄 前期がCoe外（紙・別システム）だった場合（経路2）
            </h2>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              前期の報告書ファイル（docx/PDF）は、ダッシュボードの「ナレッジ」からTier1文書として
              アップロードし、既存のナレッジ抽出フローで内容を確認しながら取り込んでください。
              抽出した現状・課題は<Link href={`/projects/${projectId}/asis-analysis`} className="underline" style={{ color: "#93c5fd" }}>As-Is分析</Link>・
              <Link href={`/projects/${projectId}/issue-hypothesis`} className="underline" style={{ color: "#93c5fd" }}>課題仮説</Link>の対話が
              ナレッジとして参照します（X3の仕組みをそのまま使用）
            </p>
          </div>
        </>
      )}
    </div>
  );
}
