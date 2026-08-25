"use client";

/**
 * 「📚 コーパス一覧」タブ — X7c §3-3
 *
 * 承認済み（status='approved'）コーパスの閲覧・検索専用パネル。
 * - 3種切替: エビデンス / 施策 / コンテキスト（context は期限切れを別枠表示）
 * - カテゴリー（field_category）chip＋件数 → クリックで絞り込み
 * - 第2軸: エビデンスレベル・規模帯・出所（source_kind）・効果量/財政効果率の有無
 * - 全文検索（ILIKE。042のpg_trgmインデックスが効く）
 * - 行クリックで詳細ドロワー（全項目＋出典リンク＋収集run逆リンク＋接地使用回数）
 * - CSV出力（棚卸し用）
 * 承認済み行の編集はここからはしない（検収の差し戻しフローを使う。閲覧専用）。
 */

import { useCallback, useEffect, useState } from "react";
import { EVIDENCE_LEVELS } from "@/lib/measure/types";
import { POPULATION_BANDS } from "@/lib/corpus/types";
import { CONTEXT_KINDS } from "@/lib/corpus/harvest/types";

type BrowseKind = "evidence" | "measures" | "context";

interface BrowseRow {
  id: string;
  title: string;
  field_category: string | null;
  population_band: string | null;
  reviewed_at: string | null;
  // evidence
  evidence_level?: number;
  design?: string;
  effect_summary?: string;
  source?: string;
  url?: string | null;
  year?: number | null;
  source_kind?: string;
  effect_size_type?: string | null;
  effect_size_value?: number | null;
  ci_low?: number | null;
  ci_high?: number | null;
  p_value?: number | null;
  fiscal_effect_rate?: number | null;
  outcome_tier?: string | null;
  // measures
  evidence_status?: string;
  intervention?: string | null;
  effect_note?: string | null;
  total_budget?: number | null;
  unit_cost?: number | null;
  source_note?: string | null;
  // context
  kind?: string;
  pestle_tag?: string;
  seven_s_tag?: string | null;
  swot_hint?: string;
  region_scope?: string;
  region_code?: string | null;
  body?: string;
  source_org?: string;
  source_url?: string | null;
  published_at?: string | null;
  effective_until?: string | null;
}

interface Chip {
  category: string | null;
  n: number;
}

interface DetailState {
  loading: boolean;
  row: Record<string, unknown> | null;
  grounding_used: number;
  harvest_run: { id: string; source_name: string; started_at: string } | null;
}

const card: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
};
const inputClass =
  "rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};

const SOURCE_KIND_LABEL: Record<string, string> = {
  measure_design: "自治体供出",
  evidence_item: "自治体供出",
  experiment_result: "自治体供出",
  knowledge_extract: "webseed/ナレッジ",
  harvest: "自動収集",
};

const CONTEXT_KIND_LABEL: Record<string, string> = Object.fromEntries(
  CONTEXT_KINDS.map((k) => [k.key, k.label]),
);

const PAGE_SIZE = 50;

/** 詳細ドロワーで隠すシステム列 */
const HIDDEN_DETAIL_KEYS = new Set(["id", "status", "contributor_key", "updated_at"]);

export default function CorpusBrowsePanel(props: { onError: (msg: string | null) => void }) {
  const { onError } = props;
  const [kind, setKind] = useState<BrowseKind>("evidence");
  const [rows, setRows] = useState<BrowseRow[] | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [total, setTotal] = useState(0);
  const [expiredCount, setExpiredCount] = useState(0);
  const [offset, setOffset] = useState(0);

  // フィルタ
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [band, setBand] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [hasEffect, setHasEffect] = useState(false);
  const [hasFiscal, setHasFiscal] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [ctxKind, setCtxKind] = useState("");

  const [detail, setDetail] = useState<DetailState | null>(null);
  const [detailTitle, setDetailTitle] = useState("");

  const buildParams = useCallback(() => {
    const p = new URLSearchParams({ kind, limit: String(PAGE_SIZE), offset: String(offset) });
    if (q.trim()) p.set("q", q.trim());
    if (category) p.set("category", category);
    if (band) p.set("band", band);
    if (kind === "evidence") {
      if (level) p.set("level", level);
      if (sourceKind) p.set("sourceKind", sourceKind);
      if (hasEffect) p.set("hasEffect", "1");
      if (hasFiscal) p.set("hasFiscal", "1");
    }
    if (kind === "measures" && sourceKind) p.set("sourceKind", sourceKind);
    if (kind === "context") {
      if (showExpired) p.set("expired", "1");
      if (ctxKind) p.set("ctxKind", ctxKind);
    }
    return p;
  }, [kind, offset, q, category, band, level, sourceKind, hasEffect, hasFiscal, showExpired, ctxKind]);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const res = await fetch(`/api/ordo-admin/corpus/browse?${buildParams().toString()}`);
      const json = (await res.json()) as {
        data: { rows: BrowseRow[]; chips: Chip[]; total: number; expired_count: number } | null;
        error: string | null;
      };
      if (res.ok && json.data) {
        setRows(json.data.rows);
        setChips(json.data.chips);
        setTotal(json.data.total);
        setExpiredCount(json.data.expired_count);
      } else {
        setRows([]);
        onError(json.error ?? "読み込みに失敗しました");
      }
    } catch {
      setRows([]);
      onError("通信エラーが発生しました");
    }
  }, [buildParams, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForKind = (k: BrowseKind) => {
    setKind(k);
    setOffset(0);
    setCategory("");
    setLevel("");
    setSourceKind("");
    setHasEffect(false);
    setHasFiscal(false);
    setShowExpired(false);
    setCtxKind("");
  };

  const openDetail = async (r: BrowseRow) => {
    setDetailTitle(r.title);
    setDetail({ loading: true, row: null, grounding_used: 0, harvest_run: null });
    try {
      const res = await fetch(`/api/ordo-admin/corpus/${kind}/${r.id}`);
      const json = (await res.json()) as {
        data: {
          row: Record<string, unknown>;
          grounding_used: number;
          harvest_run: { id: string; source_name: string; started_at: string } | null;
        } | null;
      };
      if (res.ok && json.data) {
        setDetail({ loading: false, ...json.data });
      } else {
        setDetail({ loading: false, row: null, grounding_used: 0, harvest_run: null });
      }
    } catch {
      setDetail({ loading: false, row: null, grounding_used: 0, harvest_run: null });
    }
  };

  const downloadCsv = () => {
    const p = buildParams();
    p.set("format", "csv");
    p.delete("limit");
    p.delete("offset");
    p.set("limit", "500");
    window.open(`/api/ordo-admin/corpus/browse?${p.toString()}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        承認済みコーパスの閲覧・検索（閲覧専用）。内容の修正は検収タブの「検収待ちに戻す」から行ってください
      </p>

      {/* 種別切替＋検索＋CSV */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["evidence", "エビデンス"],
            ["measures", "施策"],
            ["context", "コンテキスト"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => resetForKind(k)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={
              kind === k
                ? { background: "#6366f130", color: "#818cf8", border: "1px solid #6366f160" }
                : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
            }
          >
            {label}
          </button>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setQ(qInput);
          }}
        >
          <input
            className={`${inputClass} min-w-[200px]`}
            style={inputStyle}
            placeholder="全文検索（タイトル・要約・出典）"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            検索
          </button>
        </form>
        <span className="flex-1" />
        <button
          onClick={downloadCsv}
          className="px-3 py-1.5 rounded-lg text-xs"
          style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          ⬇ CSV出力
        </button>
      </div>

      {/* カテゴリーchip */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setCategory("");
              setOffset(0);
            }}
            className="px-2.5 py-1 rounded-full text-[11px]"
            style={
              category === ""
                ? { background: "#6366f130", color: "#818cf8", border: "1px solid #6366f160" }
                : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
            }
          >
            すべて
          </button>
          {chips.map((c) => (
            <button
              key={c.category ?? "（未分類）"}
              onClick={() => {
                setCategory(category === c.category ? "" : (c.category ?? ""));
                setOffset(0);
              }}
              disabled={c.category == null}
              className="px-2.5 py-1 rounded-full text-[11px] disabled:opacity-50"
              style={
                category === c.category
                  ? { background: "#6366f130", color: "#818cf8", border: "1px solid #6366f160" }
                  : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
              }
            >
              {c.category ?? "未分類"}（{c.n}）
            </button>
          ))}
        </div>
      )}

      {/* 第2軸フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        {kind === "evidence" && (
          <>
            <select
              className={inputClass}
              style={inputStyle}
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">全レベル</option>
              {[5, 4, 3, 2, 1].map((lv) => (
                <option key={lv} value={lv}>
                  Lv{lv}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setHasEffect((v) => !v);
                setOffset(0);
              }}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={
                hasEffect
                  ? { background: "#3b82f622", color: "#93c5fd", border: "1px solid #3b82f655" }
                  : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
              }
            >
              効果量あり
            </button>
            <button
              onClick={() => {
                setHasFiscal((v) => !v);
                setOffset(0);
              }}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={
                hasFiscal
                  ? { background: "#10b98122", color: "#6ee7b7", border: "1px solid #10b98155" }
                  : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
              }
            >
              財政効果率あり
            </button>
          </>
        )}
        {kind !== "context" && (
          <select
            className={inputClass}
            style={inputStyle}
            value={sourceKind}
            onChange={(e) => {
              setSourceKind(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">全出所</option>
            <option value="harvest">自動収集</option>
            <option value="knowledge_extract">webseed/ナレッジ</option>
            {kind === "measures" ? (
              <option value="measure_design">自治体供出</option>
            ) : (
              <>
                <option value="evidence_item">自治体供出（エビデンス欄）</option>
                <option value="experiment_result">自治体供出（実験結果）</option>
              </>
            )}
          </select>
        )}
        {kind === "context" && (
          <>
            <select
              className={inputClass}
              style={inputStyle}
              value={ctxKind}
              onChange={(e) => {
                setCtxKind(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">全種別</option>
              {CONTEXT_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setShowExpired((v) => !v);
                setOffset(0);
              }}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={
                showExpired
                  ? { background: "#f59e0b22", color: "#fbbf24", border: "1px solid #f59e0b55" }
                  : { color: "var(--text-secondary)", border: "1px solid var(--border)" }
              }
            >
              ⏳ 期限切れを表示{expiredCount > 0 ? `（${expiredCount}）` : ""}
            </button>
          </>
        )}
        <select
          className={inputClass}
          style={inputStyle}
          value={band}
          onChange={(e) => {
            setBand(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">全規模帯</option>
          {POPULATION_BANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {total}件
        </span>
      </div>

      {/* 一覧 */}
      {rows === null ? (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          該当する承認済み行がありません
        </p>
      ) : (
        <div className="rounded-xl overflow-hidden" style={card}>
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => void openDetail(r)}
              className="w-full text-left px-4 py-2.5 hover:opacity-80"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <p className="text-xs font-semibold break-words" style={{ color: "var(--text-primary)" }}>
                {kind === "evidence" && r.evidence_level != null && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded mr-1.5"
                    style={{
                      background: (EVIDENCE_LEVELS[r.evidence_level as 1 | 2 | 3 | 4 | 5]?.color ?? "#94a3b8") + "22",
                      color: EVIDENCE_LEVELS[r.evidence_level as 1 | 2 | 3 | 4 | 5]?.color ?? "#94a3b8",
                    }}
                  >
                    Lv{r.evidence_level}
                  </span>
                )}
                {kind === "context" && (
                  <span
                    className="text-[10px] font-normal px-1.5 py-0.5 rounded mr-1.5"
                    style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                  >
                    {CONTEXT_KIND_LABEL[r.kind ?? ""] ?? r.kind}
                  </span>
                )}
                {r.title}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {r.field_category ?? "未分類"}
                {kind === "evidence" && (
                  <>
                    {r.effect_summary && ` / ${r.effect_summary.slice(0, 60)}${r.effect_summary.length > 60 ? "…" : ""}`}
                    {r.effect_size_value != null && ` / 効果量 ${r.effect_size_value}`}
                    {r.fiscal_effect_rate != null && ` / 財政効果率 ${r.fiscal_effect_rate}`}
                    {` / ${r.source ?? ""}${r.year ? `（${r.year}）` : ""}`}
                    {r.source_kind && ` / ${SOURCE_KIND_LABEL[r.source_kind] ?? r.source_kind}`}
                  </>
                )}
                {kind === "measures" && (
                  <>
                    {r.effect_note && ` / ${r.effect_note.slice(0, 60)}`}
                    {r.total_budget != null && ` / 事業費 ${Number(r.total_budget).toLocaleString("ja-JP")}円`}
                    {r.source_kind && ` / ${SOURCE_KIND_LABEL[r.source_kind] ?? r.source_kind}`}
                  </>
                )}
                {kind === "context" && (
                  <>
                    {` / PESTLE:${r.pestle_tag}`}
                    {r.effective_until && ` / 期限 ${r.effective_until}`}
                    {` / ${r.source_org ?? ""}`}
                  </>
                )}
                {r.reviewed_at && ` / 承認 ${r.reviewed_at.slice(0, 10)}`}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* ページング */}
      {total > PAGE_SIZE && (
        <div className="flex items-center gap-2">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            ← 前
          </button>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {offset + 1}〜{Math.min(offset + PAGE_SIZE, total)} / {total}
          </span>
          <button
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            次 →
          </button>
        </div>
      )}

      {/* 詳細ドロワー */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: "#00000088" }}
          onClick={() => setDetail(null)}
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto p-5 space-y-3"
            style={{ background: "var(--bg-primary)", borderLeft: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold break-words" style={{ color: "var(--text-primary)" }}>
                {detailTitle}
              </h3>
              <button
                onClick={() => setDetail(null)}
                className="px-2 py-1 rounded text-xs shrink-0"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                閉じる
              </button>
            </div>
            {detail.loading ? (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>読み込み中…</p>
            ) : !detail.row ? (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>詳細を取得できませんでした</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span
                    className="px-2 py-0.5 rounded"
                    style={{ background: "#6366f122", color: "#818cf8" }}
                  >
                    接地に使われた回数: {detail.grounding_used}回
                  </span>
                  {detail.harvest_run && (
                    <span
                      className="px-2 py-0.5 rounded"
                      style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
                    >
                      収集: {detail.harvest_run.source_name}（{detail.harvest_run.started_at.slice(0, 10)}）
                    </span>
                  )}
                </div>
                {typeof detail.row.url === "string" && detail.row.url && (
                  <a
                    href={detail.row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline break-all"
                    style={{ color: "#93c5fd" }}
                  >
                    {detail.row.url}
                  </a>
                )}
                {typeof detail.row.source_url === "string" && detail.row.source_url && (
                  <a
                    href={detail.row.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline break-all"
                    style={{ color: "#93c5fd" }}
                  >
                    {detail.row.source_url}
                  </a>
                )}
                <div className="rounded-xl p-3 space-y-1" style={card}>
                  {Object.entries(detail.row)
                    .filter(([k, v]) => !HIDDEN_DETAIL_KEYS.has(k) && v != null && v !== "")
                    .map(([k, v]) => (
                      <p key={k} className="text-[11px] break-words" style={{ color: "var(--text-secondary)" }}>
                        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                          {k}
                        </span>
                        : {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </p>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
