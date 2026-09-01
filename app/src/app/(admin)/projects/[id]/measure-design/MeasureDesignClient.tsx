"use client";

/**
 * 施策構築（EBPM）— E1: 一覧・詳細（データセットの可視化）
 *
 * この画面の役割は「フォーマット（データセット）が何を要求しているか」を
 * 常に見えるようにすること。7区画の充足度を出し、
 * どこが埋まればC評価・A改善に耐える施策になるのかを示す。
 *
 * エビデンス探索・実験設計・指標・コストを埋める対話は E2〜E4 で実装する。
 * それまでは基本項目の編集と確定条件の判定（canConfirm）が動く。
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OutcomeScoreboard from "@/components/outcome/OutcomeScoreboard";
import type { ScoreboardKpi } from "@/lib/outcome/tiers";
import MeasureDialoguePanel from "@/components/measure/MeasureDialoguePanel";
import ExperimentResultsPanel from "@/components/measure/ExperimentResultsPanel";
import MeasureDatasetPanel from "@/components/measure/MeasureDatasetPanel";
import {
  MEASURE_SECTIONS,
  EVIDENCE_LEVELS,
  EVIDENCE_STATUS_META,
  EXPERIMENT_DESIGN_META,
  sectionCompleteness,
  canConfirm,
  type MeasureDesign,
} from "@/lib/measure/types";

interface HypothesisRow {
  id: string;
  title: string;
  root_cause: string | null;
  status: string;
}

interface KpiRow {
  id: string;
  label: string;
  unit: string;
  indicator_type: string | null;
}

/**
 * 目標（長期アウトカム）から入ってきたときの絞り込み。
 * 計画概要の「目的・目標を見る」で目標をタップすると付いてくる。
 */
export interface MeasureFocus {
  /** タップされた目標そのもの */
  kpi: ScoreboardKpi;
  /** この目標に寄与すると宣言している下位指標（到達状況の読み筋になる） */
  contributors: ScoreboardKpi[];
  /** この目標に紐づく主要施策のID */
  measureIds: string[];
  planStartDate: string | null;
  planEndDate: string | null;
}

interface Props {
  project: { id: string; title: string };
  projectId: string;
  initialMeasures: MeasureDesign[];
  hypotheses: HypothesisRow[];
  kpis: KpiRow[];
  /** 指定が無いときは従来どおり全施策を表示する */
  focus?: MeasureFocus | null;
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

const GRADE_COLOR: Record<0 | 1 | 2, string> = {
  0: "#475569",
  1: "#f59e0b",
  2: "#10b981",
};

function CompletenessBar({ m }: { m: MeasureDesign }) {
  const c = sectionCompleteness(m);
  return (
    <div className="flex items-center gap-1" title="区画の充足度（灰=未着手 / 黄=一部 / 緑=完了）">
      {MEASURE_SECTIONS.map((s) => (
        <span
          key={s.key}
          className="h-1.5 rounded-full"
          style={{ width: 18, background: GRADE_COLOR[c[s.key]] }}
          title={`${s.label}: ${c[s.key] === 2 ? "完了" : c[s.key] === 1 ? "一部" : "未着手"}`}
        />
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value == null || value === "";
  return (
    <div>
      <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
      {empty ? (
        <p className="text-xs text-slate-600">未入力</p>
      ) : (
        <p className="text-xs text-slate-200 leading-relaxed break-words">{value}</p>
      )}
    </div>
  );
}

export default function MeasureDesignClient({
  project,
  projectId,
  initialMeasures,
  hypotheses,
  kpis,
  focus = null,
}: Props) {
  const router = useRouter();
  // 目標から入ってきたときは一覧（＝ロジックモデル詳細）を最初に開く
  const [tab, setTab] = useState<"dialogue" | "list">(focus ? "list" : "dialogue");
  const [measures, setMeasures] = useState<MeasureDesign[]>(initialMeasures);
  const [openId, setOpenId] = useState<string | null>(
    // この目標の施策が1件だけなら、詳細画面として開いた状態で見せる
    focus && focus.measureIds.length === 1 ? (focus.measureIds[0] ?? null) : null,
  );
  const [showLevels, setShowLevels] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", issue_hypothesis_id: "", approach: "" });
  // X3: コーパス同意（オプトイン自治体のみ供出ボタンを出す）
  const [corpusOptedIn, setCorpusOptedIn] = useState(false);
  const [contributedMsg, setContributedMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/admin/corpus/consent");
        const json = (await res.json()) as { data: { opted_in: boolean } | null };
        if (alive && res.ok && json.data) setCorpusOptedIn(json.data.opted_in);
      } catch {
        /* 同意不明時はボタン非表示のまま */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const contribute = async (id: string) => {
    setBusy(id);
    setError(null);
    setContributedMsg(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/measure-design/${id}/contribute`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        data: { evidence_contributed: number } | null;
        error: string | null;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "供出に失敗しました");
        return;
      }
      setContributedMsg(
        `コーパスへ供出しました（エビデンス${json.data.evidence_contributed}件を含む）。運営の検収後に横断参照の対象になります`,
      );
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const kpiById = useMemo(() => new Map(kpis.map((k) => [k.id, k])), [kpis]);
  const hypById = useMemo(() => new Map(hypotheses.map((h) => [h.id, h])), [hypotheses]);

  // 目標から入ってきたときだけ絞る。絞り込みは表示だけで、
  // 反映・確定・対話の各処理は従来どおり measures 全体を対象にしている。
  const visibleMeasures = useMemo(() => {
    if (!focus) return measures;
    const ids = new Set(focus.measureIds);
    return measures.filter((m) => ids.has(m.id));
  }, [measures, focus]);

  // 冒頭に出す到達状況は「該当する目標」と、それに寄与すると宣言された下位指標だけ
  const focusKpis = useMemo(
    () => (focus ? [focus.kpi, ...focus.contributors] : []),
    [focus],
  );

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/measure-design/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: MeasureDesign | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? `更新に失敗しました（HTTP ${res.status}）`);
        return;
      }
      setMeasures((prev) => prev.map((m) => (m.id === id ? json.data! : m)));
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (form.title.trim() === "") return;
    setBusy("new");
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/measure-design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          issue_hypothesis_id: form.issue_hypothesis_id || null,
          approach: form.approach.trim() || null,
        }),
      });
      const json = (await res.json()) as { data: MeasureDesign | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "作成に失敗しました");
        return;
      }
      setMeasures((prev) => [...prev, json.data!]);
      setOpenId(json.data.id);
      setShowNew(false);
      setForm({ title: "", issue_hypothesis_id: "", approach: "" });
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  /** 対話からの書き出し後に一覧を取り直す */
  const reloadMeasures = async () => {
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/measure-design`);
      const json = (await res.json()) as { data: MeasureDesign[] | null };
      if (res.ok && json.data) setMeasures(json.data);
    } catch {
      /* 次の描画で router.refresh に任せる */
    }
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/measure-design/${id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "削除に失敗しました");
        return;
      }
      setMeasures((prev) => prev.filter((m) => m.id !== id));
      if (openId === id) setOpenId(null);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* 目標から入ってきたとき: その目標の到達状況を冒頭に置く */}
      {focus && (
        <>
          <OutcomeScoreboard
            kpis={focusKpis}
            planStartDate={focus.planStartDate}
            planEndDate={focus.planEndDate}
            title={`アウトカム到達状況 — ${focus.kpi.label}`}
          />
          <div
            className="rounded-xl border px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
            style={{ background: "#6366f110", borderColor: "#6366f140" }}
          >
            <p className="text-xs text-slate-300 leading-relaxed">
              目標「<span className="text-slate-100 font-semibold">{focus.kpi.label}</span>」
              に紐づく主要施策のロジックモデルを表示しています（
              {visibleMeasures.length}件）。
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href={`/projects/${projectId}`}
                className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
              >
                ← 計画概要
              </Link>
              <Link
                href={`/projects/${projectId}/measure-design`}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                すべての施策を見る →
              </Link>
            </div>
          </div>
        </>
      )}

      {/* ヘッダー */}
      <div className="rounded-2xl border p-6 space-y-3" style={cardStyle}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-slate-100">施策構築（EBPM）</h2>
            <p className="text-xs text-slate-500 mt-1">{project.title}</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: "#6366f1" }}
          >
            ＋ 施策を起こす
          </button>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          課題仮説設定で到達した<strong className="text-slate-200">真因</strong>を断つ施策を、
          エビデンスと評価の準備を揃えた<strong className="text-slate-200">データセット</strong>
          として構築します。まず参照可能なエビデンスを探し、無ければ自治体の規模・状況に応じた
          実験設計（RCT等）を添えます。指標はストラクチャー／プロセス／アウトカムの三層で持ち、
          短期・中間KPIとコストの算定式まで揃えてから確定します。
          確定した施策はロジックモデルの活動になり、C評価・A改善はこのデータセットを前提に動きます。
        </p>
        <button
          onClick={() => setShowLevels((v) => !v)}
          className="text-xs transition-opacity hover:opacity-70"
          style={{ color: "#06b6d4" }}
        >
          {showLevels ? "▲ エビデンスレベルの階層を閉じる" : "▼ エビデンスレベルの階層（5段階）を見る"}
        </button>
        {showLevels && (
          <div className="rounded-xl border p-4 space-y-2" style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Maryland Scientific Methods Scale と医療分野のエビデンスピラミッドに準拠した5段階。
              「エビデンスあり」の一言で済ませず、どの強さかまで記録します。
            </p>
            {[5, 4, 3, 2, 1].map((lv) => {
              const meta = EVIDENCE_LEVELS[lv as 1 | 2 | 3 | 4 | 5];
              return (
                <div key={lv} className="flex items-start gap-2">
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                    style={{ background: meta.color + "22", color: meta.color }}
                  >
                    Lv{lv}
                  </span>
                  <span className="text-xs text-slate-300">
                    {meta.label}
                    <span className="text-slate-500">（{meta.designs}）— {meta.note}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* タブ: 対話で構築 / データセット一覧 */}
      <div className="flex gap-2">
        {(
          [
            { key: "dialogue", label: "AIと構築（対話）" },
            {
              key: "list",
              label: focus
                ? `この目標の施策（${visibleMeasures.length}）`
                : `データセット一覧（${measures.length}）`,
            },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            style={
              tab === t.key
                ? { background: "#6366f120", color: "#a5b4fc", border: "1px solid #6366f140" }
                : {
                    background: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dialogue" && (
        <MeasureDialoguePanel
          projectId={projectId}
          hypotheses={hypotheses}
          onCommitted={() => {
            void reloadMeasures();
            setTab("list");
          }}
        />
      )}

      {error && tab === "list" && (
        <div
          role="alert"
          className="rounded-xl px-4 py-2.5 text-sm"
          style={{ background: "#ef444418", color: "#fca5a5", border: "1px solid #ef444440" }}
        >
          ⚠ {error}
        </div>
      )}

      {contributedMsg && tab === "list" && (
        <div
          className="rounded-xl px-4 py-2.5 text-sm"
          style={{ background: "#10b98118", color: "#6ee7b7", border: "1px solid #10b98140" }}
        >
          🌐 {contributedMsg}
        </div>
      )}

      {/* 一覧 */}
      {tab === "list" && (visibleMeasures.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center" style={{ borderColor: "var(--border)" }}>
          {focus ? (
            <>
              <p className="text-sm text-slate-500 mb-2">
                この目標に紐づく主要施策はまだありません。
              </p>
              <p className="text-xs text-slate-600">
                課題仮説設定でこの指標の課題仮説を立て、「AIと構築」タブで真因から
                施策を組み立てると、ここに現れます。
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500 mb-2">施策はまだありません。</p>
              <p className="text-xs text-slate-600">
                「AIと構築」タブで課題仮説（真因）から対話で組み立てるか、
                「＋ 施策を起こす」で手動で作成してください。
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleMeasures.map((m) => {
            const open = openId === m.id;
            const evMeta = EVIDENCE_STATUS_META[m.evidence_status];
            const hyp = m.issue_hypothesis_id ? hypById.get(m.issue_hypothesis_id) : null;
            const verdict = canConfirm(m);
            const comp = sectionCompleteness(m);
            return (
              <div key={m.id} className="rounded-2xl border overflow-hidden" style={cardStyle}>
                {/* 行ヘッダー */}
                <button
                  onClick={() => setOpenId(open ? null : m.id)}
                  className="w-full px-5 py-4 flex items-center gap-3 text-left"
                >
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      background: m.status === "confirmed" ? "#10b98120" : "#94a3b820",
                      color: m.status === "confirmed" ? "#10b981" : "#94a3b8",
                      border: `1px solid ${m.status === "confirmed" ? "#10b98140" : "#94a3b840"}`,
                    }}
                  >
                    {m.status === "confirmed" ? "確定" : "下書き"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-100 truncate">{m.title}</span>
                    {hyp && (
                      <span className="block text-[11px] text-slate-500 truncate mt-0.5">
                        真因: {m.root_cause_snapshot ?? hyp.root_cause ?? hyp.title}
                      </span>
                    )}
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: evMeta.color + "18", color: evMeta.color, border: `1px solid ${evMeta.color}40` }}
                  >
                    {evMeta.label}
                  </span>
                  <CompletenessBar m={m} />
                  <span className="text-slate-500 text-xs shrink-0">{open ? "▲" : "▼"}</span>
                </button>

                {open && (
                  <div className="px-5 pb-5 pt-1 border-t space-y-4" style={{ borderColor: "var(--border)" }}>
                    {/* A. 出所 */}
                    <Section title="A. 出所" grade={comp.origin}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="課題仮説" value={hyp ? hyp.title : null} />
                        <Field label="真因（設計時点の写し）" value={m.root_cause_snapshot} />
                      </div>
                    </Section>

                    {/* B. 施策の定義 */}
                    <Section title="B. 施策の定義" grade={comp.definition}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="作用機序（真因にどう働きかけるか）" value={m.approach} />
                        <Field
                          label="対象"
                          value={
                            m.target_population
                              ? `${m.target_population}${m.target_size != null ? `（約${m.target_size.toLocaleString("ja-JP")}人）` : ""}`
                              : null
                          }
                        />
                        <Field label="介入内容（何を・頻度・期間・強度）" value={m.intervention} />
                        <Field label="実施体制" value={m.delivery} />
                        <Field
                          label="実施期間"
                          value={m.period_start ? `${m.period_start} 〜 ${m.period_end ?? "未定"}` : null}
                        />
                      </div>
                    </Section>

                    {/* C. エビデンス */}
                    <Section title="C. エビデンス" grade={comp.evidence}>
                      <p className="text-[11px] mb-2" style={{ color: evMeta.color }}>
                        {evMeta.label} — {evMeta.desc}
                      </p>
                      {m.evidence_items.length === 0 ? (
                        <p className="text-xs text-slate-600">
                          記録されたエビデンスはありません（探索はAI対話で行います）
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {m.evidence_items.map((e, i) => {
                            const lv = EVIDENCE_LEVELS[e.evidence_level];
                            return (
                              <div
                                key={i}
                                className="rounded-lg px-3 py-2"
                                style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                              >
                                <div className="flex items-start gap-2">
                                  <span
                                    className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                                    style={{ background: lv.color + "22", color: lv.color }}
                                  >
                                    Lv{e.evidence_level}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-xs text-slate-200 break-words">
                                      {e.title}
                                      <span className="text-slate-500">（{e.source}{e.year ? `・${e.year}` : ""}）</span>
                                    </p>
                                    <p className="text-[11px] text-slate-400 mt-0.5">{e.effect_summary}</p>
                                    {e.transferability && (
                                      <p className="text-[11px] text-slate-500 mt-0.5">
                                        外的妥当性: {e.transferability}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Section>

                    {/* D. 実験設計 */}
                    <Section title="D. 実験設計" grade={comp.experiment}>
                      {m.evidence_status === "sufficient" ? (
                        <p className="text-xs text-slate-500">
                          参照エビデンスが十分なため、実験設計は不要です
                        </p>
                      ) : m.experiment ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-200">
                            {EXPERIMENT_DESIGN_META[m.experiment.design]?.label ?? m.experiment.design}
                            <span
                              className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: "#6366f120", color: "#818cf8" }}
                            >
                              得られるレベル: Lv{EXPERIMENT_DESIGN_META[m.experiment.design]?.level ?? "?"}
                            </span>
                          </p>
                          <Field label="この設計を選ぶ理由" value={m.experiment.rationale} />
                          <div className="grid gap-3 md:grid-cols-2">
                            <Field label="割付単位・群" value={[m.experiment.unit, m.experiment.arms].filter(Boolean).join(" / ") || null} />
                            <Field label="検出力の目安" value={m.experiment.sample_size_note} />
                            <Field label="主要評価項目" value={m.experiment.primary_outcome} />
                            <Field label="倫理・同意" value={m.experiment.ethical_note} />
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs" style={{ color: "#f59e0b" }}>
                          ⚠ エビデンスが不足しているのに実験設計がありません。
                          このままでは確定できません（AI対話で設計を提案します）
                        </p>
                      )}
                      {/* X2: 実験結果 → エビデンス昇格（循環の閉じ目） */}
                      <ExperimentResultsPanel
                        projectId={projectId}
                        measureId={m.id}
                        hasExperiment={!!m.experiment}
                        defaultDesign={m.experiment?.design ?? null}
                        onPromoted={() => void reloadMeasures()}
                      />
                    </Section>

                    {/* 取組・指標17カテゴリ・年度別コスト（057）。
                        評価フロー図6は取組ごと、図7は主要施策ごとに回るため、
                        ここで二層に分けて持ち、スケジュール設定へも反映する */}
                    <Section title="E. 取組と指標（プログラム評価指標一覧）">
                      <MeasureDatasetPanel projectId={projectId} measureId={m.id} canEdit={m.status !== "confirmed"} />
                    </Section>

                    {/* E-2. 対話で決めた三層指標（従来の区画。参照用に残す） */}
                    <Section title="E-2. 対話で決めた指標（三層）" grade={comp.indicators}>
                      <div className="grid gap-3 md:grid-cols-3">
                        <IndicatorList label="ストラクチャー（体制・投入）" items={m.structure_indicators.map((s) => s.text)} />
                        <IndicatorList label="プロセス（実施量・実施率）" items={m.process_indicators.map((s) => s.text)} />
                        <div>
                          <p className="text-[10px] text-slate-500 mb-0.5">アウトカムKPI</p>
                          {m.kpi_ids_initial.length === 0 && m.kpi_ids_intermediate.length === 0 ? (
                            <p className="text-xs text-slate-600">未設定</p>
                          ) : (
                            <ul className="space-y-1">
                              {m.kpi_ids_initial.map((id) => (
                                <li key={id} className="text-xs text-slate-300">
                                  <span className="text-[10px]" style={{ color: "#9ae6c8" }}>短期</span>{" "}
                                  {kpiById.get(id)?.label ?? id}
                                </li>
                              ))}
                              {m.kpi_ids_intermediate.map((id) => (
                                <li key={id} className="text-xs text-slate-300">
                                  <span className="text-[10px]" style={{ color: "#4cc59d" }}>中間</span>{" "}
                                  {kpiById.get(id)?.label ?? id}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </Section>

                    {/* F. コスト */}
                    <Section title="F. コスト・効率性" grade={comp.cost}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field
                          label="総事業費"
                          value={m.total_budget != null ? `¥${m.total_budget.toLocaleString("ja-JP")}` : null}
                        />
                        <Field
                          label="対象1人あたり"
                          value={m.unit_cost != null ? `¥${m.unit_cost.toLocaleString("ja-JP")}` : null}
                        />
                        <Field label="成果1単位あたり費用の算定式（効率性評価が使用）" value={m.cost_per_outcome_note} />
                        <Field label="財源" value={m.funding} />
                      </div>
                      {/* X4: 積算内訳（費目別） */}
                      {m.budget_breakdown.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[10px] text-slate-500 mb-1">積算内訳（費目別）</p>
                          <div
                            className="rounded-lg overflow-hidden"
                            style={{ border: "1px solid var(--border)" }}
                          >
                            {m.budget_breakdown.map((b, i) => (
                              <div
                                key={i}
                                className="flex items-start justify-between gap-2 px-3 py-1.5 text-xs"
                                style={{
                                  background: i % 2 === 0 ? "var(--bg-primary)" : "transparent",
                                }}
                              >
                                <span className="text-slate-300 shrink-0">{b.item}</span>
                                <span className="text-slate-500 text-[11px] flex-1 text-right break-words">
                                  {b.note}
                                </span>
                                <span className="text-slate-200 font-mono shrink-0 w-24 text-right">
                                  {b.amount != null ? `¥${b.amount.toLocaleString("ja-JP")}` : "—"}
                                </span>
                              </div>
                            ))}
                            {m.budget_breakdown.some((b) => b.amount != null) && (
                              <div
                                className="flex justify-between px-3 py-1.5 text-xs font-bold"
                                style={{ borderTop: "1px solid var(--border)" }}
                              >
                                <span className="text-slate-400">内訳計</span>
                                <span className="text-slate-200 font-mono">
                                  ¥
                                  {m.budget_breakdown
                                    .reduce((a, b) => a + (b.amount ?? 0), 0)
                                    .toLocaleString("ja-JP")}
                                  {m.total_budget != null &&
                                    m.budget_breakdown.reduce((a, b) => a + (b.amount ?? 0), 0) !==
                                      m.total_budget && (
                                      <span className="ml-1" style={{ color: "#f59e0b" }}>
                                        （総事業費と不一致）
                                      </span>
                                    )}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </Section>

                    {/* G. 実行 */}
                    <Section title="G. 実行" grade={comp.execution}>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="所管" value={m.owner_department} />
                        <Field
                          label="マイルストーン"
                          value={m.milestones.length > 0 ? m.milestones.map((x) => x.label).join(" → ") : null}
                        />
                      </div>
                    </Section>

                    {/* 操作 */}
                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                      {m.status === "draft" ? (
                        <>
                          <button
                            onClick={() => void patch(m.id, { status: "confirmed" })}
                            disabled={busy === m.id || !verdict.ok}
                            title={verdict.reason ?? "この施策を確定します"}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                            style={{ background: "#10b981" }}
                          >
                            確定する
                          </button>
                          {!verdict.ok && (
                            <span className="text-[11px]" style={{ color: "#f59e0b" }}>
                              {verdict.reason}
                            </span>
                          )}
                          <button
                            onClick={() => void remove(m.id)}
                            disabled={busy === m.id}
                            className="px-3 py-1.5 rounded-lg text-xs ml-auto disabled:opacity-40"
                            style={{ color: "#f87171", border: "1px solid #ef444440" }}
                          >
                            削除
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs" style={{ color: "#10b981" }}>
                            ✓ 確定済み{m.committed_at ? `（${m.committed_at.slice(0, 10)}）` : ""}
                          </span>
                          <button
                            onClick={() => void patch(m.id, { status: "draft" })}
                            disabled={busy === m.id}
                            className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                            style={{ color: "#94a3b8", border: "1px solid var(--border)" }}
                          >
                            下書きに戻す
                          </button>
                          {corpusOptedIn && (
                            <button
                              onClick={() => void contribute(m.id)}
                              disabled={busy === m.id}
                              className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
                              title="自治体名を匿名化し、他自治体が参照できる横断コーパスへ供出します（運営の検収後に公開）"
                              style={{ color: "#818cf8", border: "1px solid #6366f140" }}
                            >
                              🌐 コーパスへ供出
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <p className="text-[11px] text-slate-600 leading-relaxed">
        アプローチの導出からエビデンス探索・実験設計・指標・コストまで、
        施策データセットの全区画を「AIと構築」タブの対話で埋められます。
        確定した施策は、ロジックモデル画面の「施策構築から取り込む」で
        活動・産出・アウトカム（KPI割当済み）として展開されます。
      </p>

      {/* 新規作成ダイアログ */}
      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "#00000090" }}
          onClick={() => busy !== "new" && setShowNew(false)}
        >
          <div
            className="rounded-2xl border w-full max-w-lg p-6 space-y-4"
            style={cardStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-100">施策を起こす</h3>
            <div>
              <label className="text-xs text-slate-400 block mb-1">起点となる課題仮説（真因）</label>
              <select
                value={form.issue_hypothesis_id}
                onChange={(e) => setForm((p) => ({ ...p, issue_hypothesis_id: e.target.value }))}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">（選択しない — 後から紐づけ可能）</option>
                {hypotheses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.title}
                    {h.root_cause ? ` — 真因: ${h.root_cause.slice(0, 40)}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-600 mt-1">
                選ぶと、その時点の真因が施策に写しとして保存されます
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">施策名（必須）</label>
              <input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="例: 通いの場への個別勧奨と送迎支援"
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">作用機序（任意）</label>
              <textarea
                value={form.approach}
                onChange={(e) => setForm((p) => ({ ...p, approach: e.target.value }))}
                rows={2}
                placeholder="真因にどう働きかけて断つのか"
                className={`${inputClass} resize-none`}
                style={inputStyle}
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setShowNew(false)}
                disabled={busy === "new"}
                className="text-xs px-3 py-1.5 rounded-lg text-slate-400"
              >
                やめる
              </button>
              <button
                onClick={() => void create()}
                disabled={busy === "new" || form.title.trim() === ""}
                className="text-xs font-semibold px-4 py-1.5 rounded-lg text-white disabled:opacity-40"
                style={{ background: "#6366f1" }}
              >
                {busy === "new" ? "作成中..." : "作成する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  grade,
  children,
}: {
  title: string;
  /** 区画の充足度。持たない区画（自前で不足を出すもの）は省略できる */
  grade?: 0 | 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: "#94a3b8" }}>
        {grade != null && (
          <span className="h-2 w-2 rounded-full inline-block" style={{ background: GRADE_COLOR[grade] }} />
        )}
        {title}
      </p>
      <div className="pl-4">{children}</div>
    </div>
  );
}

function IndicatorList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-600">未設定</p>
      ) : (
        <ul className="space-y-1">
          {items.map((t, i) => (
            <li key={i} className="text-xs text-slate-300 flex gap-1.5">
              <span className="text-indigo-400/60 shrink-0">•</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
