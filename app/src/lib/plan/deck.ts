/**
 * 受益者向け説明資料（PL4 P④）— スライド構成・語彙・変換（純粋・テスト可能）
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * スライド定義（全体概要 / 取組別）・AI出力の防御・
 * PlanSection（plan_documents.sections）との相互変換はここに集約する。
 *
 * plan_documents に variant='deck' で同居し、既存機構を共用する:
 *   スライド ←→ PlanSection の対応:
 *     heading   = スライドの見出し
 *     body_md   = 箇条書き本文（md-lite の「- 」）
 *     summary   = **読み原稿（ノート欄）** — 話し言葉・1枚45〜60秒目安
 *     locked    = 生成・リライトからの保護（章ロックと同じ）
 *   → 既存の PATCH / rewrite（本文＋summaryを書き直す）がそのまま使える。
 */

import type { PlanChapterDef, PlanSection } from "@/lib/plan/document";

/** plan_documents.variant 上の説明資料の値（051 の CHECK と同一） */
export const DECK_VARIANT = "deck" as const;

// ─── スライド定義 ─────────────────────────────────────────

/** 全体概要（設計 P④: 表紙→なぜ→目指す姿→取組一覧→スケジュール→問い合わせ先） */
export const OVERVIEW_SLIDES: readonly PlanChapterDef[] = [
  { id: "cover", heading: "表紙", brief: "計画の名称・自治体名・サブタイトル（誰に向けた説明か）" },
  { id: "why", heading: "なぜこの計画か", brief: "地域の課題と真因を、専門用語を使わず住民目線で平易に" },
  { id: "vision", heading: "目指す姿", brief: "長期アウトカム（この計画で地域がどう変わるか）を生活の言葉で" },
  { id: "measures", heading: "取組の一覧", brief: "主な取組を1行ずつ（何をする・誰のため）" },
  { id: "schedule", heading: "スケジュール", brief: "いつ何が始まるか・節目（詳細な工程表ではなく生活者に関わる時期）" },
  { id: "contact", heading: "お問い合わせ", brief: "担当課・参加や相談の入口（不明な項目は（記入してください）のプレースホルダ）" },
] as const;

/** 取組別スライドの型（設計 P④: 表紙→変わること→対象・申込→内容・スケジュール→FAQ） */
export const MEASURE_SLIDE_KINDS = [
  { suffix: "benefit", heading: "この取組で変わること", brief: "受益者目線の便益（〜できるようになる・〜が楽になる）" },
  { suffix: "target", heading: "対象・申し込み方法", brief: "誰が対象か・どうすれば参加/利用できるか（不明ならプレースホルダ）" },
  { suffix: "content", heading: "実施内容とスケジュール", brief: "何を・どこで・いつから（生活者に必要な範囲で）" },
  { suffix: "faq", heading: "よくある質問", brief: "費用・持ち物・申込期限など想定問答を3〜4問（Q: / A: 形式の箇条書き）" },
] as const;

export interface DeckMeasureInput {
  id: string;
  title: string;
}

/**
 * 取組別デッキのスライド定義を動的に組む。
 * id は `m:<施策UUID>:<種別>`（UUID36+接頭辞+種別 ≦ 60文字 — sections の id 上限内）。
 * 表紙1枚＋施策ごとに4枚。locked の突き合わせは id 一致で行うので、
 * 同じ施策を選び直せば手動編集（ロック済み）はそのまま残る。
 */
export function measureSlideDefs(measures: DeckMeasureInput[]): PlanChapterDef[] {
  const defs: PlanChapterDef[] = [
    { id: "cover", heading: "表紙", brief: "取組の名称（複数なら総称）・自治体名・誰に向けた説明か" },
  ];
  for (const m of measures) {
    for (const k of MEASURE_SLIDE_KINDS) {
      defs.push({
        id: `m:${m.id}:${k.suffix}`,
        heading: `${m.title} — ${k.heading}`,
        brief: k.brief,
      });
    }
  }
  return defs;
}

/** デッキの対象（generateの入力） */
export const DECK_TARGETS = ["overview", "measures"] as const;
export type DeckTarget = (typeof DECK_TARGETS)[number];

export function deckTargetOf(raw: unknown): DeckTarget {
  return raw === "measures" ? "measures" : "overview";
}

// ─── pptx レンダラの入力（PlanSection から復元） ───────────

export interface DeckSlide {
  id: string;
  title: string;
  bullets: string[];
  /** ノート欄に入れる読み原稿（話し言葉・45〜60秒目安） */
  note: string;
}

/**
 * PlanSection → スライド。body_md の「- 」行を箇条書きに、その他の行も1項目として扱う
 * （md-lite の見出しはスライドでは使わない — 1枚=1見出しの原則）。
 */
export function sectionToSlide(s: PlanSection): DeckSlide {
  const bullets: string[] = [];
  for (const rawLine of s.body_md.split(/\r?\n/)) {
    const t = rawLine.trim();
    if (!t) continue;
    const b = t.match(/^(?:-\s+|・\s*)(.+)$/);
    const h = t.match(/^#{2,3}\s+(.+)$/);
    bullets.push((b?.[1] ?? h?.[1] ?? t).trim());
  }
  return {
    id: s.id,
    title: s.heading,
    bullets: bullets.slice(0, 10),
    note: s.summary,
  };
}

export function sectionsToSlides(sections: PlanSection[]): DeckSlide[] {
  return sections.map(sectionToSlide);
}
