/**
 * 分野パックの登録簿 — 設計: claude/coe-dataset-model.md §5-1
 *
 * Coe は特定の行政分野の SaaS ではない。コア辞書（../dictionary.ts）は分野中立に保ち、
 * 制度に固有の属性は「分野パック」としてここに登録する。計画の `plan_type` に一致する
 * パックだけが、その計画の属性辞書に現れる。
 *
 * ── 分野を足すとき ────────────────────────────────────────
 * 1. `domains/<分野>.ts` を作り、`PLAN_TYPE` と属性の配列を export する
 *    （各属性の `planTypes` にその分野だけを入れる）
 * 2. この登録簿に1行足す
 * 3. `npm run check:dataset` を通す（コアに分野語彙が混ざっていないかも `check:generic` が見る）
 * 4. migration で `attribute_definitions` に投入する（共通行: municipality_id IS NULL）
 *
 * 分野パックが無い分野でも Coe は使える。コア辞書＋自治体ごとのテナント拡張で足りる。
 * パックは「よく使う属性の初期値」であって、必須ではない。
 */
import type { AttributeDefinition } from "../types";
import { CARE_INSURANCE_PACK, PLAN_TYPE as CARE_INSURANCE } from "./care-insurance";
import { CHILD_CARE_PACK, PLAN_TYPE as CHILD_CARE } from "./child-care";

export interface DomainPack {
  planType: string;
  label: string;
  /** 実運用で検証済みか。false のものは画面で「初期セット」と示す */
  reviewed: boolean;
  attributes: readonly AttributeDefinition[];
}

export const DOMAIN_PACKS: readonly DomainPack[] = [
  { planType: CARE_INSURANCE, label: "介護保険事業計画", reviewed: true, attributes: CARE_INSURANCE_PACK },
  { planType: CHILD_CARE, label: "子ども・子育て支援事業計画", reviewed: false, attributes: CHILD_CARE_PACK },
];

/** その計画種別の分野パック（無ければ空） */
export function packFor(planType: string | null | undefined): DomainPack | undefined {
  if (!planType) return undefined;
  return DOMAIN_PACKS.find((p) => p.planType === planType);
}

/** すべての分野パックの属性（マイグレーションの投入に使う） */
export function allDomainAttributes(): AttributeDefinition[] {
  return DOMAIN_PACKS.flatMap((p) => [...p.attributes]);
}
