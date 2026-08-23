// アウトカム・スコアボード
//
// 長期アウトカムは「達成／未達」で判定できない（期限が来るまで判定不能）。
// 代わりに、経過時間から算出した「いまいるべき到達度」を縦線で示し、
// 塗りとの位置関係で軌道上かどうかを一目で読めるようにする。
//
// 三層（長期・中間・短期）を縦に積むのは、
// 「短期は達成しているのに長期が逆行している」という最も重要な異常を
// 発見できるようにするため。
//
// フックを使わないため、サーバーコンポーネントとしてもクライアント配下でも動く。

import {
  calcAchievement,
  calcPace,
  conditionLabel,
  type PaceStatus,
} from "@/lib/stats/achievement";
import {
  OUTCOME_TIER_META,
  buildContributionMap,
  formatValue,
  groupByTier,
  tierMismatch,
  type OutcomeTier,
  type ScoreboardKpi,
} from "@/lib/outcome/tiers";

interface Props {
  kpis: ScoreboardKpi[];
  /** 計画開始日（必要ペースの算出に使う） */
  planStartDate: string | null;
  /** 計画終了日。KPI に期限が無い場合のフォールバック */
  planEndDate: string | null;
  /** 見出しの右に出す時点表示。省略時は現在日 */
  asOfLabel?: string;
  /** 概要ページ以外で使うときにタイトルを差し替える */
  title?: string;
  compact?: boolean;
}

const STATUS_STYLE: Record<PaceStatus, { color: string; bg: string }> = {
  ontrack: { color: "#10b981", bg: "#10b98118" },
  behind: { color: "#f59e0b", bg: "#f59e0b18" },
  regressing: { color: "#ef4444", bg: "#ef444418" },
  unknown: { color: "#94a3b8", bg: "#64748b18" },
};

function fmtDate(d: string | null): string {
  if (!d) return "期限未設定";
  const [y, m] = d.split("-");
  if (!y || !m) return d;
  return `${y}年${parseInt(m, 10)}月`;
}

function yearsLeft(deadline: string | null, asOf: Date): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  const diff = (d.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (diff < 0) return "期限超過";
  if (diff < 1) return `残り${Math.max(1, Math.round(diff * 12))}か月`;
  return `残り${Math.round(diff)}年`;
}

/**
 * 宣言された評価スパンと、目標期限から推定したスパンのずれを知らせる。
 *
 * KPI 作成時の指標タイプが既定値「短期」に固定されていたため、
 * 期限が十数年先の指標まで短期に分類される状態が起きていた。
 * 担当者の設定は勝手に変えず、気づけるようにだけする。
 */
function TierMismatchNote({
  kpi,
  planStartDate,
}: {
  kpi: ScoreboardKpi;
  planStartDate: string | null;
}) {
  const m = tierMismatch(kpi.indicator_type, planStartDate, kpi.target_deadline);
  if (!m) return null;
  return (
    <p
      className="text-[10px] leading-snug mb-1.5"
      style={{ color: "#f59e0b" }}
      title="指標タイプはKPI編集画面で変更できます"
    >
      ⚠ 期限から見ると{OUTCOME_TIER_META[m.inferred].label}
      （{OUTCOME_TIER_META[m.inferred].span}）に見えます
    </p>
  );
}

// ─── 長期アウトカム: 到達度メーター付きカード ─────────────
function LongTermCard({
  kpi,
  planStartDate,
  planEndDate,
  asOf,
  contributors,
}: {
  kpi: ScoreboardKpi;
  planStartDate: string | null;
  planEndDate: string | null;
  asOf: Date;
  contributors: ScoreboardKpi[];
}) {
  const ach = calcAchievement({
    current: kpi.current,
    target: kpi.target,
    baseline: kpi.baseline_value,
    condition: kpi.achievement_condition,
  });
  const deadline = kpi.target_deadline ?? planEndDate;
  const pace = calcPace(planStartDate, deadline, ach.rate, asOf);
  const st = STATUS_STYLE[pace.status];

  // 到達度の塗り: 負値は 0 から左に伸ばせないため、0〜100 に丸めた幅で表現し、
  // 逆行は色と判定ラベルで示す（数値も併記する）
  const fillWidth = ach.rate == null ? 0 : Math.max(0, Math.min(100, ach.rate));
  const fillColor =
    ach.rate == null ? "#64748b" : ach.rate < 0 ? "#ef4444" : st.color;

  return (
    <div
      className="rounded-xl border p-5 relative overflow-hidden"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0"
        style={{ width: 3, background: fillColor }}
      />

      <h4 className="text-sm font-semibold text-slate-100 leading-snug mb-1">{kpi.label}</h4>
      <TierMismatchNote kpi={kpi} planStartDate={planStartDate} />
      <p className="text-[11px] text-slate-500 mb-4">
        {formatValue(kpi.target, kpi.unit)}
        {conditionLabel(kpi.achievement_condition)} ／ 期限 {fmtDate(deadline)}
        {yearsLeft(deadline, asOf) ? ` ／ ${yearsLeft(deadline, asOf)}` : ""}
      </p>

      <div className="flex items-end gap-5 mb-4 flex-wrap">
        <span>
          <span className="block text-[10px] tracking-wide text-slate-500">
            基準値{kpi.baseline_year ? ` ${kpi.baseline_year}` : ""}
          </span>
          <span className="text-lg font-semibold text-slate-200 tabular-nums">
            {formatValue(kpi.baseline_value, kpi.unit)}
          </span>
        </span>
        <span>
          <span className="block text-[10px] tracking-wide text-slate-500">現在値</span>
          <span className="text-lg font-semibold text-slate-200 tabular-nums">
            {formatValue(kpi.current, kpi.unit)}
          </span>
        </span>
        <span>
          <span className="block text-[10px] tracking-wide text-slate-500">目標</span>
          <span className="text-lg font-semibold tabular-nums" style={{ color: "#34d399" }}>
            {formatValue(kpi.target, kpi.unit)}
          </span>
        </span>
      </div>

      {/* 到達度メーター */}
      <div
        className="relative rounded-full"
        style={{ height: 9, background: "var(--bg-input)" }}
        role="img"
        aria-label={`到達度 ${ach.rate ?? "未算定"}パーセント、必要ペース ${pace.requiredPace ?? "不明"}パーセント`}
      >
        <div
          className="absolute top-0 bottom-0 rounded-full"
          style={{ left: 0, width: `${fillWidth}%`, background: fillColor }}
        />
        {pace.requiredPace != null && (
          <span
            aria-hidden="true"
            className="absolute rounded"
            style={{
              left: `${Math.min(100, Math.max(0, pace.requiredPace))}%`,
              top: -5,
              bottom: -5,
              width: 2,
              background: "#cbd5e1",
            }}
          />
        )}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-slate-500 tabular-nums">
        <span>0% 基準値</span>
        <span style={{ color: fillColor }}>
          到達度 {ach.rate == null ? "—" : `${ach.rate}%`}
        </span>
        <span>100% 目標</span>
      </div>
      {pace.requiredPace != null && (
        <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
          ／ いまいるべき位置（必要ペース）: {pace.requiredPace}%
        </p>
      )}

      <div
        className="flex items-start gap-3 mt-4 pt-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <span
          className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0"
          style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}` }}
        >
          {pace.label}
        </span>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          {pace.diff == null
            ? "期限または現在値が未設定のため、軌道の判定ができません。"
            : pace.status === "regressing"
              ? `基準値より悪化しています。必要ペースとの差は ${pace.diff}pt。`
              : `必要ペースを ${pace.diff > 0 ? "+" : ""}${pace.diff}pt ${pace.diff >= 0 ? "上回って" : "下回って"}います。`}
          {contributors.length > 0 && (
            <span className="text-slate-500">
              {" "}
              ／ 寄与する中間アウトカム {contributors.length}件
            </span>
          )}
        </p>
      </div>

      {ach.basis !== "none" && (
        <details className="mt-2">
          <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">
            算定式を表示
          </summary>
          <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed break-all">
            {ach.formula}
            {ach.basis === "ratio" && (
              <span className="block mt-1" style={{ color: "#f59e0b" }}>
                基準値を設定すると、策定時からの前進量で正しく測れます。
              </span>
            )}
          </p>
        </details>
      )}
    </div>
  );
}

// ─── 中間・短期: チップ ────────────────────────────
function TierChip({
  kpi,
  parentLabel,
  contributorCount,
  planStartDate,
}: {
  kpi: ScoreboardKpi;
  parentLabel: string | null;
  contributorCount: number;
  planStartDate: string | null;
}) {
  const ach = calcAchievement({
    current: kpi.current,
    target: kpi.target,
    baseline: kpi.baseline_value,
    condition: kpi.achievement_condition,
  });
  const rate = ach.rate;
  const color =
    rate == null ? "#94a3b8" : rate < 0 ? "#ef4444" : rate >= 80 ? "#10b981" : rate >= 50 ? "#34d399" : "#f59e0b";

  return (
    <div
      className="rounded-lg border p-3"
      style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
    >
      <p className="text-[11.5px] text-slate-300 leading-snug mb-2 font-medium">{kpi.label}</p>
      <TierMismatchNote kpi={kpi} planStartDate={planStartDate} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold tabular-nums" style={{ color }}>
          {rate == null ? "—" : `${rate}%`}
        </span>
        <span className="text-[10px] text-slate-500 tabular-nums">
          {formatValue(kpi.current, kpi.unit)} → {formatValue(kpi.target, kpi.unit)}
        </span>
      </div>
      <div
        className="rounded-full overflow-hidden mt-2"
        style={{ height: 4, background: "var(--bg-input)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${ach.clamped}%`, background: color }}
        />
      </div>
      {(parentLabel || contributorCount > 0) && (
        <p
          className="text-[10px] text-slate-500 mt-2 pt-1.5 truncate"
          style={{ borderTop: "1px dashed var(--border)" }}
          title={parentLabel ?? undefined}
        >
          {parentLabel ? `↑ ${parentLabel} に寄与` : ""}
          {parentLabel && contributorCount > 0 ? " ／ " : ""}
          {contributorCount > 0 ? `下位 ${contributorCount}件` : ""}
        </p>
      )}
    </div>
  );
}

function TierHeading({ tier, count }: { tier: OutcomeTier; count: number }) {
  const m = OUTCOME_TIER_META[tier];
  return (
    <div className="flex items-center gap-2.5 mb-3 mt-6 first:mt-0">
      <span
        aria-hidden="true"
        className="rounded-sm shrink-0"
        style={{ width: 10, height: 10, background: m.color }}
      />
      <span className="text-[11.5px] font-bold tracking-wider text-slate-300">
        {m.label}
      </span>
      <span className="text-[10px] text-slate-500">{m.span}</span>
      <span className="flex-1 h-px" style={{ background: "var(--border)" }} />
      <span className="text-[10px] text-slate-500">{m.note} ／ {count}件</span>
    </div>
  );
}

// ─── 本体 ────────────────────────────────────────
export default function OutcomeScoreboard({
  kpis,
  planStartDate,
  planEndDate,
  asOfLabel,
  title = "アウトカム到達状況",
  compact = false,
}: Props) {
  const asOf = new Date();
  const grouped = groupByTier(kpis);
  const contributions = buildContributionMap(kpis);
  const labelById = new Map(kpis.map((k) => [k.id, k.label]));

  const total =
    grouped.outcome_long.length +
    grouped.outcome_intermediate.length +
    grouped.outcome_initial.length;

  if (total === 0) {
    return (
      <div
        className="rounded-xl border p-6"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        <h3 className="text-sm font-semibold text-slate-300 mb-1">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          アウトカム指標がまだ登録されていません。KPI の「指標タイプ」を
          短期／中間／長期アウトカムに設定すると、ここに到達状況が表示されます。
        </p>
      </div>
    );
  }

  const period =
    planStartDate && planEndDate
      ? `計画期間 ${fmtDate(planStartDate)} – ${fmtDate(planEndDate)}`
      : "計画期間が未設定";

  return (
    <section
      className="rounded-xl border p-5"
      style={{ background: "var(--bg-primary)", borderColor: "var(--border)" }}
      aria-label={title}
    >
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <h3 className="text-base font-semibold text-slate-100">{title}</h3>
        <span className="text-[11px] text-slate-500">
          {asOfLabel ?? `${asOf.getFullYear()}年${asOf.getMonth() + 1}月時点`} ／ {period}
        </span>
      </div>

      {grouped.outcome_long.length > 0 && (
        <>
          <TierHeading tier="outcome_long" count={grouped.outcome_long.length} />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}
          >
            {grouped.outcome_long.map((k) => (
              <LongTermCard
                key={k.id}
                kpi={k}
                planStartDate={planStartDate}
                planEndDate={planEndDate}
                asOf={asOf}
                contributors={contributions.get(k.id) ?? []}
              />
            ))}
          </div>
        </>
      )}

      {!compact &&
        (["outcome_intermediate", "outcome_initial"] as const).map((tier) =>
          grouped[tier].length === 0 ? null : (
            <div key={tier}>
              <TierHeading tier={tier} count={grouped[tier].length} />
              <div
                className="grid gap-2.5"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}
              >
                {grouped[tier].map((k) => (
                  <TierChip
                    key={k.id}
                    kpi={k}
                    parentLabel={
                      k.contributes_to_kpi_id
                        ? (labelById.get(k.contributes_to_kpi_id) ?? null)
                        : null
                    }
                    contributorCount={(contributions.get(k.id) ?? []).length}
                    planStartDate={planStartDate}
                  />
                ))}
              </div>
            </div>
          ),
        )}
    </section>
  );
}
