"use client";

/**
 * 独自AI管理画面（クライアント側）— X1/X5
 *
 * - ルーティング: タスク種別ごとの動作モードと独自AIウェートのダイヤル。
 *   X1時点で実際に動くのは claude のみ。他のモードは設定として保存でき、
 *   実装が追い付いた段階（X4〜）から効き始める（ゲートウェイが安全側に解決）。
 * - 利用状況: 直近30日のタスク別集計と日別推移（ai_usage_logs）。
 *   独自AIへの移行判断（どのタスクから移すか）の材料にする。
 */

import { useMemo, useState } from "react";
import {
  AI_TASK_TYPES,
  IMPLEMENTED_ROUTING_MODES,
  type AiRoutingMode,
} from "@/lib/ai/taskTypes";

export interface RoutingRow {
  task_type: string;
  mode: AiRoutingMode;
  ordo_weight: number;
  note: string | null;
  updated_at: string;
}

export interface UsageByTask {
  task_type: string;
  provider: string;
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  avg_latency_ms: number;
}

export interface UsageByDay {
  day: string;
  calls: number;
  errors: number;
}

export interface GroundingStat {
  task_type: string;
  mode: string;
  groundings: number;
  with_hits: number;
  injected: number;
  adopted: number;
}

export interface CorpusCounts {
  measures_approved: number;
  measures_pending: number;
  evidence_approved: number;
  evidence_pending: number;
}

interface Props {
  initialRouting: RoutingRow[];
  usageByTask: UsageByTask[];
  usageByDay: UsageByDay[];
  groundingStats?: GroundingStat[];
  corpusCounts?: CorpusCounts;
}

const MODE_META: Record<AiRoutingMode, { label: string; desc: string; color: string }> = {
  claude: {
    label: "Claude",
    desc: "従来どおり Claude API のみで応答（既定）",
    color: "#94a3b8",
  },
  shadow: {
    label: "シャドー",
    desc: "Claudeを正とし、裏でコーパス検索を並走させて記録のみ取る（対話系タスクで有効）",
    color: "#f59e0b",
  },
  assist: {
    label: "アシスト",
    desc: "コーパス検索結果（検収済みの類似施策・エビデンス・コスト実績）をClaudeのプロンプトに接地する",
    color: "#06b6d4",
  },
  primary: {
    label: "独自AI主体",
    desc: "独自AIが主・Claudeは補助（未実装。当面は assist として動作）",
    color: "#10b981",
  },
};

/** タスク種別キーの接頭辞 → 表示グループ */
const GROUPS: { prefix: string; label: string; icon: string }[] = [
  { prefix: "dialogue.", label: "対話（ファシリテーション）", icon: "💬" },
  { prefix: "proposal.", label: "提案", icon: "💡" },
  { prefix: "generation.", label: "生成", icon: "📝" },
  { prefix: "analysis.", label: "分析", icon: "📊" },
  { prefix: "knowledge.", label: "ナレッジ", icon: "📚" },
];

const LABEL_BY_KEY = new Map(AI_TASK_TYPES.map((t) => [t.key as string, t.label]));

export default function AiManagementClient({
  initialRouting,
  usageByTask,
  usageByDay,
  groundingStats = [],
  corpusCounts = {
    measures_approved: 0,
    measures_pending: 0,
    evidence_approved: 0,
    evidence_pending: 0,
  },
}: Props) {
  const [routing, setRouting] = useState<RoutingRow[]>(initialRouting);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const usageByTaskMap = useMemo(() => {
    const m = new Map<string, UsageByTask[]>();
    for (const u of usageByTask) {
      const arr = m.get(u.task_type) ?? [];
      arr.push(u);
      m.set(u.task_type, arr);
    }
    return m;
  }, [usageByTask]);

  const totals = useMemo(() => {
    let calls = 0;
    let errors = 0;
    let outTokens = 0;
    for (const u of usageByTask) {
      calls += u.calls;
      errors += u.errors;
      outTokens += u.output_tokens;
    }
    return { calls, errors, outTokens };
  }, [usageByTask]);

  const maxDayCalls = useMemo(
    () => Math.max(1, ...usageByDay.map((d) => d.calls)),
    [usageByDay],
  );

  const update = async (
    taskType: string,
    patch: { mode?: AiRoutingMode; ordo_weight?: number; note?: string | null },
  ) => {
    setBusy(taskType);
    setError(null);
    try {
      const res = await fetch("/api/ordo-admin/ai/routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_type: taskType, ...patch }),
      });
      const json = (await res.json()) as { data: RoutingRow | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? `更新に失敗しました（HTTP ${res.status}）`);
        return;
      }
      setRouting((prev) =>
        prev.some((r) => r.task_type === taskType)
          ? prev.map((r) => (r.task_type === taskType ? json.data! : r))
          : [...prev, json.data!],
      );
      setSavedAt(new Date().toLocaleTimeString("ja-JP"));
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const rowFor = (key: string): RoutingRow =>
    routing.find((r) => r.task_type === key) ?? {
      task_type: key,
      mode: "claude",
      ordo_weight: 0,
      note: null,
      updated_at: "",
    };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          🤖 独自AI管理
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          AIゲートウェイのタスク別ルーティング（Claude → 独自AIへの段階移行のダイヤル）と利用状況
        </p>
        <p className="text-xs mt-2 rounded-lg px-3 py-2 inline-block"
          style={{ background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b40" }}>
          コーパス接地（X4）が有効です: shadow=裏で検索・記録のみ / assist=プロンプトへ注入。
          接地が実装されているのは対話系（現状整理・施策構築）タスクで、primary は当面 assist として動作します。
        </p>
      </div>

      {/* 利用状況サマリー */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "呼び出し数（30日）", value: totals.calls.toLocaleString("ja-JP"), color: "#6366f1" },
          { label: "エラー数", value: totals.errors.toLocaleString("ja-JP"), color: totals.errors > 0 ? "#ef4444" : "#10b981" },
          {
            label: "エラー率",
            value: totals.calls > 0 ? `${((totals.errors / totals.calls) * 100).toFixed(1)}%` : "—",
            color: "#06b6d4",
          },
          { label: "出力トークン（30日）", value: Math.round(totals.outTokens).toLocaleString("ja-JP"), color: "#8b5cf6" },
        ].map((s) => (
          <div key={s.label} className="glass-card rounded-2xl p-4" style={{ borderLeft: `3px solid ${s.color}` }}>
            <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* 日別推移 */}
      {usageByDay.length > 0 && (
        <div className="glass-card rounded-2xl p-5">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            日別の呼び出し数（直近30日）
          </h2>
          <div className="flex items-end gap-[3px]" style={{ height: 72 }}>
            {usageByDay.map((d) => (
              <div
                key={d.day}
                className="flex-1 rounded-t"
                title={`${d.day}: ${d.calls}回${d.errors > 0 ? ` / エラー${d.errors}` : ""}`}
                style={{
                  height: `${Math.max(4, (d.calls / maxDayCalls) * 100)}%`,
                  background: d.errors > 0 ? "#ef4444aa" : "#6366f1aa",
                  minWidth: 3,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{usageByDay[0]?.day}</span>
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{usageByDay[usageByDay.length - 1]?.day}</span>
          </div>
        </div>
      )}

      {/* ── X6: 接地の状況と次の一手（段階移行ガイド）── */}
      {(() => {
        const approvedTotal = corpusCounts.measures_approved + corpusCounts.evidence_approved;
        const pendingTotal = corpusCounts.measures_pending + corpusCounts.evidence_pending;
        const groundedTasks = ["dialogue.measure", "dialogue.asis"];
        const modeOf = (key: string) => rowFor(key).mode;
        const statsFor = (key: string) => {
          const rows = groundingStats.filter((g) => g.task_type === key);
          const sum = (f: (g: GroundingStat) => number) => rows.reduce((a, g) => a + f(g), 0);
          return {
            groundings: sum((g) => g.groundings),
            with_hits: sum((g) => g.with_hits),
            injected: sum((g) => g.injected),
            adopted: sum((g) => g.adopted),
          };
        };
        // 次の一手の判定（透明な規則）
        let advice: string;
        const allClaude = groundedTasks.every((k) => modeOf(k) === "claude");
        const anyShadow = groundedTasks.some((k) => modeOf(k) === "shadow");
        const anyAssist = groundedTasks.some(
          (k) => modeOf(k) === "assist" || modeOf(k) === "primary",
        );
        if (approvedTotal === 0) {
          advice =
            pendingTotal > 0
              ? `検収待ちが${pendingTotal}件あります。まず「コーパス管理 > 検収」で承認してください。承認済みが増えるまでダイヤルは Claude のままで問題ありません`
              : "まだ承認済みコーパスがありません。自治体からの供出とナレッジ抽出でコーパスを育ててください（それまでダイヤルは Claude のままで問題ありません）";
        } else if (allClaude) {
          advice = `承認済みコーパスが${approvedTotal}件あります。対話系タスク（施策構築・現状整理）を shadow にして、ヒット率（対話に関係する行が見つかる割合）をこのパネルで確認するのが次の一手です`;
        } else if (anyShadow && !anyAssist) {
          const st = statsFor("dialogue.measure");
          const rate = st.groundings > 0 ? st.with_hits / st.groundings : 0;
          advice =
            st.groundings === 0
              ? "shadow 運用中です。対話が使われると接地の記録がここに貯まります"
              : rate >= 0.3
                ? `shadow のヒット率が${Math.round(rate * 100)}%あります。assist に上げて、コーパスの知見を実際の対話に注入する段階です`
                : `shadow のヒット率は${Math.round(rate * 100)}%です。まだ低いので、コーパスの拡充（供出・抽出・検収）を続けてから assist に上げてください`;
        } else {
          advice =
            "assist 運用中です。採択率（接地した対話が書き出しまで到達した割合）を見ながら、コーパスの拡充と検収を続けてください";
        }
        return (
          <div className="glass-card rounded-2xl p-5">
            <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
              🧭 接地の状況と次の一手
            </h2>
            <p
              className="text-xs rounded-lg px-3 py-2 mb-3"
              style={{ background: "#6366f118", color: "#a5b4fc", border: "1px solid #6366f140" }}
            >
              {advice}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              {[
                { label: "承認済みコーパス", value: `${approvedTotal}件`, sub: `施策${corpusCounts.measures_approved} / エビデンス${corpusCounts.evidence_approved}` },
                { label: "検収待ち", value: `${pendingTotal}件`, sub: `施策${corpusCounts.measures_pending} / エビデンス${corpusCounts.evidence_pending}` },
              ].map((c) => (
                <div key={c.label} className="rounded-xl px-3 py-2" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                  <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{c.label}</p>
                  <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{c.value}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{c.sub}</p>
                </div>
              ))}
              {groundedTasks.map((key) => {
                const st = statsFor(key);
                const rate = st.groundings > 0 ? Math.round((st.with_hits / st.groundings) * 100) : null;
                const adoptedRate = st.injected > 0 ? Math.round((st.adopted / st.injected) * 100) : null;
                return (
                  <div key={key} className="rounded-xl px-3 py-2" style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}>
                    <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                      {LABEL_BY_KEY.get(key) ?? key}（30日）
                    </p>
                    <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                      {st.groundings > 0 ? `ヒット率${rate}%` : "記録なし"}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                      接地{st.groundings}回 / 注入{st.injected}
                      {adoptedRate != null && ` / 採択率${adoptedRate}%`}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              段階移行の道筋: Claude のみ → shadow（裏で検索・記録のみ）→ assist（対話に注入）。
              ヒット率=接地のうち関係する行が見つかった割合 / 採択率=注入した対話が書き出しまで到達した割合（粗い定義・v0）
            </p>
          </div>
        );
      })()}

      {error && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: "#ef444418", color: "#f87171" }}>
          {error}
        </p>
      )}
      {savedAt && !error && (
        <p className="text-xs" style={{ color: "#10b981" }}>✓ 保存しました（{savedAt}）</p>
      )}

      {/* ルーティング設定 */}
      {GROUPS.map((g) => {
        const keys = AI_TASK_TYPES.filter((t) => t.key.startsWith(g.prefix)).map((t) => t.key);
        if (keys.length === 0) return null;
        return (
          <div key={g.prefix} className="glass-card rounded-2xl p-5">
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
              {g.icon} {g.label}
            </h2>
            <div className="space-y-3">
              {keys.map((key) => {
                const r = rowFor(key);
                const usages = usageByTaskMap.get(key) ?? [];
                const calls = usages.reduce((a, u) => a + u.calls, 0);
                const errors = usages.reduce((a, u) => a + u.errors, 0);
                const avgLatency = usages.length > 0
                  ? Math.round(usages.reduce((a, u) => a + u.avg_latency_ms * u.calls, 0) / Math.max(1, calls))
                  : 0;
                const mm = MODE_META[r.mode];
                const implemented = IMPLEMENTED_ROUTING_MODES.includes(r.mode);
                return (
                  <div
                    key={key}
                    className="rounded-xl px-4 py-3"
                    style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-[220px]">
                        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
                          {LABEL_BY_KEY.get(key) ?? key}
                        </p>
                        <p className="text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>{key}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          className="rounded-lg px-2 py-1 text-xs"
                          style={{
                            background: "var(--bg-secondary)",
                            border: `1px solid ${mm.color}60`,
                            color: mm.color,
                          }}
                          value={r.mode}
                          disabled={busy === key}
                          onChange={(e) => void update(key, { mode: e.target.value as AiRoutingMode })}
                          title={mm.desc}
                        >
                          {(Object.keys(MODE_META) as AiRoutingMode[]).map((m) => (
                            <option key={m} value={m}>
                              {MODE_META[m].label}
                              {IMPLEMENTED_ROUTING_MODES.includes(m) ? "" : "（未実装・予約）"}
                            </option>
                          ))}
                        </select>
                        {!implemented && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: "#f59e0b20", color: "#f59e0b" }}>
                            予約（現在はClaudeで動作）
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                        <span className="text-[10px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                          独自AIウェート
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={r.ordo_weight}
                          disabled={busy === key}
                          className="flex-1"
                          onChange={(e) =>
                            setRouting((prev) =>
                              prev.some((x) => x.task_type === key)
                                ? prev.map((x) =>
                                    x.task_type === key
                                      ? { ...x, ordo_weight: Number(e.target.value) }
                                      : x,
                                  )
                                : [...prev, { ...r, ordo_weight: Number(e.target.value) }],
                            )
                          }
                          onMouseUp={(e) =>
                            void update(key, { ordo_weight: Number((e.target as HTMLInputElement).value) })
                          }
                          onTouchEnd={(e) =>
                            void update(key, { ordo_weight: Number((e.target as HTMLInputElement).value) })
                          }
                        />
                        <span className="text-xs font-bold w-10 text-right" style={{ color: "var(--accent)" }}>
                          {r.ordo_weight}%
                        </span>
                      </div>

                      <div className="text-right shrink-0 min-w-[130px]">
                        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                          30日: {calls.toLocaleString("ja-JP")}回
                          {errors > 0 && <span style={{ color: "#ef4444" }}>（エラー{errors}）</span>}
                        </p>
                        {calls > 0 && (
                          <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                            平均 {avgLatency.toLocaleString("ja-JP")}ms
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        利用ログにはプロンプト・応答の本文は保存されません（タスク種別・トークン数・レイテンシ・成否のみ）。
        採択率（AIの提案が担当者に採択された割合）はシャドー運用（X4）の開始とともに表示されます。
      </p>
    </div>
  );
}
