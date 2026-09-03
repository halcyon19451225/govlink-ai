/**
 * 収束工程の様式（G1・G2・H3）の語彙とラベル — 純粋な定数のみ。
 * クライアント（ReflectionTabs）とサーバー（reflectionData）の両方から使うため、
 * DB を持つ reflectionData.ts（server-only）から切り離してある。
 */

export type ReflectKind = "measure" | "chapter" | "not_adopted";
export type Adoption = "adopted" | "partial" | "rejected";
export type DeferredStatus = "deferred" | "re_proposed" | "adopted" | "dropped";
export type DeferredReasonKind = "budget" | "staff" | "coordination" | "verification" | "other";

export const ADOPTION_LABEL: Record<Adoption, string> = {
  adopted: "採用",
  partial: "一部採用",
  rejected: "不採用",
};
export const REFLECT_KIND_LABEL: Record<ReflectKind, string> = {
  measure: "次期施策へ",
  chapter: "章・総論・指標へ",
  not_adopted: "不採用（理由を明記）",
};
export const DEFERRED_STATUS_LABEL: Record<DeferredStatus, string> = {
  deferred: "見送り",
  re_proposed: "再上程",
  adopted: "採用",
  dropped: "取り下げ",
};
export const DEFERRED_REASON_LABEL: Record<DeferredReasonKind, string> = {
  budget: "財源",
  staff: "人材・体制",
  coordination: "他計画・他部署調整",
  verification: "効果検証に時間を要する",
  other: "その他",
};

