/**
 * 計画書の調製（PL2 P③）— 章構成・サニタイズ・md-lite（純粋・テスト可能）
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * plan_documents.sections の形・定型章構成・AI出力の防御・
 * 本文（Markdown軽量サブセット）の構造化はここに集約する。
 * 生成ルート・リライト・docxレンダラ・検査（check:plandoc）はここだけを参照する。
 */

// ─── 語彙（049 の CHECK と同一） ──────────────────────────

export const PLAN_DOC_VARIANTS = [
  { key: "full", label: "本編", detail: "全章・表紙・目次・ページ番号・見出しスタイル" },
  { key: "simple", label: "簡易版", detail: "章の要約＋KPI表＋施策一覧表" },
  { key: "digest", label: "概要版", detail: "A4見開き2〜4頁想定。目標・施策マップ・工程表" },
] as const;

export type PlanDocVariant = (typeof PLAN_DOC_VARIANTS)[number]["key"];

export const PLAN_DOC_STATUS = ["draft", "finalized"] as const;

// ─── 定型章構成（設計 P③ の7章・順序固定） ─────────────────

export interface PlanChapterDef {
  id: string;
  heading: string;
  /** 生成AIへの章の狙い（何を書く章か） */
  brief: string;
}

export const PLAN_CHAPTERS: readonly PlanChapterDef[] = [
  { id: "background", heading: "計画の背景・位置づけ", brief: "策定の経緯・上位計画や関連計画との関係・計画期間" },
  { id: "current", heading: "現状と課題", brief: "ギャップ分析・現状整理（As-Is）・課題と真因（データを引用し出典を示す）" },
  { id: "policy", heading: "基本方針・目標", brief: "基本方針とKPI（三層アウトカム）。目標値と期限を表形式の記述で" },
  { id: "measures", heading: "施策", brief: "施策ごとに目的・対象・介入内容・実施体制・エビデンス・実験設計・コスト（B〜G区画）" },
  { id: "logic_model", heading: "ロジックモデル", brief: "投入→活動→産出→初期/中間/長期アウトカムの因果仮説の説明（図は別紙参照とする）" },
  { id: "structure", heading: "推進体制・スケジュール", brief: "担当・マイルストーン・PDCAチェックポイント" },
  { id: "evaluation", heading: "評価の方法", brief: "年次評価（図6）・計画期間評価（図7）・三層アウトカムの測定方法" },
] as const;

// ─── sections の形 ────────────────────────────────────────

export interface PlanSection {
  id: string;
  heading: string;
  body_md: string;
  /** 簡易版・概要版の材料（生成時に章ごとに作る） */
  summary: string;
  source_refs: string[];
  /** true の章はAIの再生成・リライトの対象外（手動編集を守る） */
  locked: boolean;
}

const clip = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
};

export function normalizeSection(raw: unknown): PlanSection | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = clip(o["id"], 60);
  const heading = clip(o["heading"], 120);
  if (!id || !heading) return null;
  return {
    id,
    heading,
    body_md: clip(o["body_md"], 20_000),
    summary: clip(o["summary"], 1_000),
    source_refs: Array.isArray(o["source_refs"])
      ? (o["source_refs"] as unknown[]).filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 300)).slice(0, 20)
      : [],
    locked: o["locked"] === true,
  };
}

export function normalizeSections(raw: unknown): PlanSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeSection).filter((s): s is PlanSection => s != null).slice(0, 20);
}

/**
 * AI生成結果を既存sectionsへ取り込む。
 * - **locked=true の章は本文・要約を上書きしない**（手動編集の保護 — 設計どおり）
 * - 章の並びは定型章構成に従う。AIが返さなかった章は既存を残す
 * - chapters を渡すと別の定型章構成（PL3 評価報告書の6章など）で動く
 */
export function mergeGeneratedSections(
  existing: PlanSection[],
  generated: { id: string; body_md: string; summary: string; source_refs?: string[] }[],
  chapters: readonly PlanChapterDef[] = PLAN_CHAPTERS,
): PlanSection[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const genById = new Map(generated.map((g) => [g.id, g]));
  return chapters.map((ch) => {
    const cur = byId.get(ch.id);
    const gen = genById.get(ch.id);
    if (cur?.locked) return cur; // 保護
    if (!gen) {
      return cur ?? { id: ch.id, heading: ch.heading, body_md: "", summary: "", source_refs: [], locked: false };
    }
    return {
      id: ch.id,
      heading: cur?.heading ?? ch.heading,
      body_md: clip(gen.body_md, 20_000),
      summary: clip(gen.summary, 1_000),
      source_refs: (gen.source_refs ?? []).map((s) => String(s).slice(0, 300)).slice(0, 20),
      locked: false,
    };
  });
}

/** AIのツール出力（record_plan_sections）を防御的に取り込む。
 *  chapters を渡すと別の定型章構成の章IDだけを受け付ける */
export function sanitizeGeneratedSections(
  raw: unknown,
  chapters: readonly PlanChapterDef[] = PLAN_CHAPTERS,
): { id: string; body_md: string; summary: string; source_refs: string[] }[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>)["sections"];
  if (!Array.isArray(list)) return [];
  const validIds = new Set(chapters.map((c) => c.id));
  const out: { id: string; body_md: string; summary: string; source_refs: string[] }[] = [];
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = clip(o["id"], 60);
    const body = clip(o["body_md"], 20_000);
    if (!id || !validIds.has(id) || !body) continue;
    out.push({
      id,
      body_md: body,
      summary: clip(o["summary"], 1_000),
      source_refs: Array.isArray(o["source_refs"])
        ? (o["source_refs"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20)
        : [],
    });
  }
  return out;
}

// ─── md-lite（本文の構造化 — docxレンダラの入力） ──────────
//
// 対応するのは行政計画の本文で実際に使う最小限:
//   ## / ### 見出し・「- 」箇条書き・「1. 」番号付き・通常段落。
// それ以外の記法は素の文として扱う（壊れた装飾を出力しない）。

export type MdBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "bullet"; items: string[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "paragraph"; text: string };

export function parseMdLite(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = md.split(/\r?\n/);
  let bullets: string[] | null = null;
  let numbered: string[] | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", text: para.join("") });
      para = [];
    }
  };
  const flushLists = () => {
    if (bullets) {
      blocks.push({ kind: "bullet", items: bullets });
      bullets = null;
    }
    if (numbered) {
      blocks.push({ kind: "numbered", items: numbered });
      numbered = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const t = line.trim();
    const h = t.match(/^(#{2,3})\s+(.+)$/);
    if (h) {
      flushPara();
      flushLists();
      blocks.push({ kind: "heading", level: h[1]!.length === 2 ? 2 : 3, text: h[2]!.trim() });
      continue;
    }
    // 「- 」は半角スペース必須（ハイフン語と区別）。「・」は日本語慣行でスペース無しも許す
    const b = t.match(/^(?:-\s+|・\s*)(.+)$/);
    if (b) {
      flushPara();
      if (numbered) {
        blocks.push({ kind: "numbered", items: numbered });
        numbered = null;
      }
      (bullets ??= []).push(b[1]!.trim());
      continue;
    }
    // 半角「1. 」はスペース必須（1.5倍 等の小数と区別）。全角「１．」「1．」「1)」はスペース無しも許す
    const n = t.match(/^\d+(?:\.\s+|[．)]\s*)(.+)$/);
    if (n) {
      flushPara();
      if (bullets) {
        blocks.push({ kind: "bullet", items: bullets });
        bullets = null;
      }
      (numbered ??= []).push(n[1]!.trim());
      continue;
    }
    if (t === "") {
      flushPara();
      flushLists();
      continue;
    }
    // 通常行 — 連続行は1段落に結合（日本語は改行結合で自然）
    flushLists();
    para.push(t.replace(/\*\*(.+?)\*\*/g, "$1")); // 太字記法は素の文字に落とす（docx側で扱わない）
  }
  flushPara();
  flushLists();
  return blocks;
}
