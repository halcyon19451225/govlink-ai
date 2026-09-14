/**
 * 分野パック: 子ども・子育て支援事業計画（plan_type = 'kosodate'）
 *
 * ⚠ **初期セット。実運用の前に、担当課の帳票と突き合わせて精査すること。**
 *   このパックは「コア辞書が特定分野に寄っていないこと」を実証するために置いた
 *   2つ目の分野であり、介護保険パックほど検証されていない。
 *
 * 設計: claude/coe-dataset-model.md §5-1。追加・改訂の手順は domains/index.ts の頭を参照。
 */
import type { AttributeDefinition } from "../types";

export const PLAN_TYPE = "kosodate";

const AGE_CLASS: Record<string, string> = {
  age0: "0歳",
  age1_2: "1〜2歳",
  age3_5: "3〜5歳",
  school: "就学児",
};

const CERTIFICATION: Record<string, string> = {
  type1: "1号（教育標準時間）",
  type2: "2号（満3歳以上・保育）",
  type3: "3号（満3歳未満・保育）",
  none: "認定なし",
};

export const CHILD_CARE_PACK: readonly AttributeDefinition[] = [
  {
    key: "child.age_class",
    label: "児童の年齢区分",
    description: "基準日時点の児童の年齢区分。年齢そのもの（demo.age_band5）とは別に、制度上の区分で持つ",
    valueType: "code",
    codes: AGE_CLASS,
    role: "quasi_identifier",
    generalization: {
      priority: 2,
      levels: [{
        label: "就学前／就学",
        map: { age0: "pre_school", age1_2: "pre_school", age3_5: "pre_school", school: "school" },
      }],
    },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["年齢区分", "クラス"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "child.certification",
    label: "支給認定の区分",
    description: "子ども・子育て支援法に基づく認定区分",
    valueType: "code",
    codes: CERTIFICATION,
    role: "quasi_identifier",
    generalization: {
      priority: 3,
      levels: [{
        label: "保育の必要性の有無",
        map: { type1: "no_need", none: "no_need", type2: "need", type3: "need" },
      }],
    },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["認定区分", "支給認定"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "house.work_status",
    label: "保護者の就労状況",
    description: "世帯の就労の形。個人の勤務先や職種は持ち込まない",
    valueType: "code",
    codes: { dual: "両方就労", single: "一方が就労", none: "就労なし", other: "その他" },
    role: "quasi_identifier",
    generalization: { priority: 1, levels: [{ label: "削除", collapseTo: "*" }] },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["就労状況", "保護者就労"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "outcome.waitlisted",
    label: "利用保留（待機）となった",
    description: "申込みに対して当該年度に利用できなかった（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["待機", "利用保留"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "outcome.enrolled",
    label: "利用開始",
    description: "当該年度に施設・事業の利用を開始した（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["入所", "利用開始"],
    planTypes: [PLAN_TYPE],
  },
];
