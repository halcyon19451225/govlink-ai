"use client";

/**
 * 実験結果の記録・確定・昇格パネル — X2（エビデンス循環）
 *
 * 施策カードのD区画（実験設計）の直後に置かれ、
 *   記録（draft）→ 確定（confirmed）→ 昇格（エビデンス化）
 * の流れを担う。昇格するとエビデンスレベルが自動判定され、
 * 施策の evidence_items / evidence_status が更新される
 * （親は onPromoted で一覧を取り直す）。
 */

import { useCallback, useEffect, useState } from "react";
import {
  EXPERIMENT_DESIGNS,
  EXPERIMENT_DESIGN_META,
  type ExperimentDesignKey,
} from "@/lib/measure/types";
import {
  EFFECT_DIRECTIONS,
  EFFECT_DIRECTION_META,
  type EffectDirection,
} from "@/lib/measure/experimentResult";

export interface ExperimentResultRow {
  id: string;
  design: ExperimentDesignKey;
  implemented_as_planned: boolean;
  deviation_note: string | null;
  period_start: string | null;
  period_end: string | null;
  sample_size: number | null;
  primary_outcome: string | null;
  result_summary: string;
  effect_direction: EffectDirection;
  effect_size: string | null;
  status: "draft" | "confirmed";
  evidence_level: number | null;
  promoted_at: string | null;
}

interface Props {
  projectId: string;
  measureId: string;
  /** 施策にD区画（実験設計）があるか。無いと design の既定が引けない */
  hasExperiment: boolean;
  defaultDesign?: ExperimentDesignKey | null;
  /** 昇格成功後に親が施策一覧を取り直すためのフック */
  onPromoted?: () => void;
}

const inputClass =
  "w-full rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

const EMPTY_FORM = {
  design: "" as "" | ExperimentDesignKey,
  implemented_as_planned: true,
  deviation_note: "",
  period_start: "",
  period_end: "",
  sample_size: "",
  primary_outcome: "",
  result_summary: "",
  effect_direction: "unclear" as EffectDirection,
  effect_size: "",
};

export default function ExperimentResultsPanel({
  projectId,
  measureId,
  hasExperiment,
  defaultDesign,
  onPromoted,
}: Props) {
  const [rows, setRows] = useState<ExperimentResultRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/admin/projects/${projectId}/measure-design/${measureId}/experiment-results`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      const json = (await res.json()) as { data: ExperimentResultRow[] | null };
      if (res.ok && json.data) setRows(json.data);
      else setRows([]);
    } catch {
      setRows([]);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!form.result_summary.trim()) {
      setError("結果の要約を入力してください");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const body: Record<string, unknown> = {
        implemented_as_planned: form.implemented_as_planned,
        deviation_note: form.deviation_note.trim() || null,
        period_start: form.period_start || null,
        period_end: form.period_end || null,
        sample_size: form.sample_size === "" ? null : Number(form.sample_size),
        primary_outcome: form.primary_outcome.trim() || null,
        result_summary: form.result_summary.trim(),
        effect_direction: form.effect_direction,
        effect_size: form.effect_size.trim() || null,
      };
      if (form.design) body["design"] = form.design;
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "記録に失敗しました");
        return;
      }
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (id: string, status: "draft" | "confirmed") => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = (await res.json()) as { error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const promote = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}/promote`, { method: "POST" });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "昇格に失敗しました");
        return;
      }
      await load();
      onPromoted?.();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`${base}/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "削除に失敗しました");
        return;
      }
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="rounded-lg px-3 py-2.5 mt-2"
      style={{ background: "var(--bg-primary)", border: "1px dashed var(--border)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-slate-400">
          🔁 実験結果（記録 → 確定 → エビデンスへ昇格）
        </p>
        <button
          type="button"
          className="text-[11px] px-2 py-0.5 rounded"
          style={{ background: "#6366f120", color: "#818cf8" }}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "閉じる" : "＋ 結果を記録"}
        </button>
      </div>

      {error && (
        <p className="text-[11px] mt-1.5" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      {rows === null ? (
        <p className="text-[11px] text-slate-600 mt-1.5">読み込み中…</p>
      ) : rows.length === 0 && !showForm ? (
        <p className="text-[11px] text-slate-600 mt-1.5">
          まだ結果がありません。実験を実施したらここに記録すると、
          確定・昇格を経て次の計画の「参照可能なエビデンス」になります
          {!hasExperiment && "（この施策にはD区画の実験設計が無いため、記録時に設計を指定します）"}
        </p>
      ) : (
        <div className="space-y-1.5 mt-1.5">
          {rows.map((r) => {
            const dm = EXPERIMENT_DESIGN_META[r.design];
            const em = EFFECT_DIRECTION_META[r.effect_direction];
            return (
              <div
                key={r.id}
                className="rounded-lg px-2.5 py-2"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-200 break-words">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded mr-1.5"
                        style={{ background: em.color + "22", color: em.color }}
                      >
                        {em.label}
                      </span>
                      {r.result_summary}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {dm?.label ?? r.design}
                      {r.sample_size != null && ` / n=${r.sample_size}`}
                      {r.effect_size && ` / 効果量: ${r.effect_size}`}
                      {!r.implemented_as_planned && (
                        <span style={{ color: "#f59e0b" }}> / ⚠ 計画から逸脱あり</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {r.promoted_at ? (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ background: "#10b98122", color: "#10b981" }}
                      >
                        ✓ 昇格済み Lv{r.evidence_level}
                      </span>
                    ) : r.status === "confirmed" ? (
                      <>
                        <button
                          type="button"
                          disabled={busy === r.id}
                          className="text-[10px] px-2 py-0.5 rounded font-bold"
                          style={{ background: "#10b98120", color: "#10b981" }}
                          onClick={() => void promote(r.id)}
                          title="設計種別からレベルを自動判定し、施策のエビデンスに追加します"
                        >
                          ⬆ エビデンスへ昇格
                        </button>
                        <button
                          type="button"
                          disabled={busy === r.id}
                          className="text-[10px] px-1.5 py-0.5 rounded text-slate-500"
                          onClick={() => void setStatus(r.id, "draft")}
                        >
                          下書きへ
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy === r.id}
                          className="text-[10px] px-2 py-0.5 rounded"
                          style={{ background: "#6366f120", color: "#818cf8" }}
                          onClick={() => void setStatus(r.id, "confirmed")}
                        >
                          確定
                        </button>
                        <button
                          type="button"
                          disabled={busy === r.id}
                          className="text-[10px] px-1.5 py-0.5 rounded text-slate-500"
                          onClick={() => void remove(r.id)}
                        >
                          削除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="mt-2 space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">
                実施した設計{hasExperiment ? "（未選択ならD区画の設計を使用）" : "（必須）"}
              </p>
              <select
                className={inputClass}
                style={inputStyle}
                value={form.design || (hasExperiment ? "" : (defaultDesign ?? ""))}
                onChange={(e) =>
                  setForm((f) => ({ ...f, design: e.target.value as "" | ExperimentDesignKey }))
                }
              >
                {hasExperiment && <option value="">（D区画の設計のまま）</option>}
                {!hasExperiment && <option value="">選択してください</option>}
                {EXPERIMENT_DESIGNS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}（Lv{d.level}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">主要評価項目</p>
              <input
                className={inputClass}
                style={inputStyle}
                value={form.primary_outcome}
                onChange={(e) => setForm((f) => ({ ...f, primary_outcome: e.target.value }))}
                placeholder="設計時の primary_outcome に対応"
              />
            </div>
          </div>

          <div>
            <p className="text-[10px] text-slate-500 mb-0.5">結果の要約（必須）</p>
            <textarea
              className={inputClass}
              style={inputStyle}
              rows={2}
              value={form.result_summary}
              onChange={(e) => setForm((f) => ({ ...f, result_summary: e.target.value }))}
              placeholder="例: 介入群の参加率が対照群より12ポイント高かった（p<0.05）"
            />
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">効果の方向</p>
              <select
                className={inputClass}
                style={inputStyle}
                value={form.effect_direction}
                onChange={(e) =>
                  setForm((f) => ({ ...f, effect_direction: e.target.value as EffectDirection }))
                }
              >
                {EFFECT_DIRECTIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">効果量（任意）</p>
              <input
                className={inputClass}
                style={inputStyle}
                value={form.effect_size}
                onChange={(e) => setForm((f) => ({ ...f, effect_size: e.target.value }))}
                placeholder="+12pt（95%CI 4〜20）"
              />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">対象数 n（任意）</p>
              <input
                className={inputClass}
                style={inputStyle}
                type="number"
                min={0}
                value={form.sample_size}
                onChange={(e) => setForm((f) => ({ ...f, sample_size: e.target.value }))}
              />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-0.5">実施期間（任意）</p>
              <div className="flex items-center gap-1">
                <input
                  className={inputClass}
                  style={inputStyle}
                  type="date"
                  value={form.period_start}
                  onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
                />
                <input
                  className={inputClass}
                  style={inputStyle}
                  type="date"
                  value={form.period_end}
                  onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0 mt-1.5">
              <input
                type="checkbox"
                checked={form.implemented_as_planned}
                onChange={(e) =>
                  setForm((f) => ({ ...f, implemented_as_planned: e.target.checked }))
                }
              />
              計画どおり実施できた
            </label>
            {!form.implemented_as_planned && (
              <div className="flex-1">
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={form.deviation_note}
                  onChange={(e) => setForm((f) => ({ ...f, deviation_note: e.target.value }))}
                  placeholder="何が計画から外れたか（無作為化の崩れ・脱落 等）。昇格時にレベルを1段下げます"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy === "create"}
              className="text-xs px-3 py-1.5 rounded-lg font-bold"
              style={{ background: "#6366f1", color: "#fff" }}
              onClick={() => void submit()}
            >
              {busy === "create" ? "記録中…" : "結果を記録する"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
