/**
 * 分野パック: 介護保険事業計画（plan_type = 'kaigo_hoken'）
 *
 * 設計: claude/coe-dataset-model.md §5-1。**この分野を選んだ計画でだけ**辞書に現れる。
 * コア辞書（../dictionary.ts）は分野中立に保ち、制度に固有の語彙はここに閉じ込める。
 *
 * 追加・改訂の手順は domains/index.ts の頭を参照。
 */
import type { AttributeDefinition } from "../types";

export const PLAN_TYPE = "kaigo_hoken";

const CARE_LEVEL: Record<string, string> = {
  none: "非該当",
  target: "事業対象者",
  support1: "要支援1",
  support2: "要支援2",
  care1: "要介護1",
  care2: "要介護2",
  care3: "要介護3",
  care4: "要介護4",
  care5: "要介護5",
};
const CARE_LEVEL_TO_5: Record<string, string> = {
  none: "none", target: "target", support1: "support", support2: "support",
  care1: "care12", care2: "care12", care3: "care345", care4: "care345", care5: "care345",
};
const CARE5_TO_2: Record<string, string> = {
  none: "no_cert", target: "no_cert", support: "cert", care12: "cert", care345: "cert",
};

const DEMENTIA: Record<string, string> = {
  none: "自立", I: "Ⅰ", IIa: "Ⅱa", IIb: "Ⅱb", IIIa: "Ⅲa", IIIb: "Ⅲb", IV: "Ⅳ", M: "M",
};
const ADL: Record<string, string> = {
  none: "自立", J1: "J1", J2: "J2", A1: "A1", A2: "A2", B1: "B1", B2: "B2", C1: "C1", C2: "C2",
};

export const CARE_INSURANCE_PACK: readonly AttributeDefinition[] = [
  {
    key: "care.level",
    label: "要介護度",
    description: "基準日時点の要介護認定の区分。経年比較（維持改善率）はこの属性の2時点で計算する",
    valueType: "code",
    codes: CARE_LEVEL,
    role: "quasi_identifier",
    generalization: {
      priority: 4,
      levels: [
        { label: "5区分（非該当／事業対象者／要支援／要介護1-2／要介護3-5）", map: CARE_LEVEL_TO_5 },
        { label: "認定の有無", map: CARE5_TO_2 },
      ],
    },
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["要介護度", "認定区分", "要介護状態区分"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "health.dementia_level",
    label: "認知症高齢者の日常生活自立度",
    description: "認定調査・主治医意見書の区分",
    valueType: "code",
    codes: DEMENTIA,
    role: "sensitive",
    generalization: {
      priority: 1,
      levels: [{
        label: "3区分",
        map: { none: "none", I: "I_II", IIa: "I_II", IIb: "I_II", IIIa: "III+", IIIb: "III+", IV: "III+", M: "III+" },
      }],
    },
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["認知症自立度", "認知症高齢者の日常生活自立度"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "health.adl_level",
    label: "障害高齢者の日常生活自立度",
    description: "認定調査・主治医意見書の区分",
    valueType: "code",
    codes: ADL,
    role: "sensitive",
    generalization: {
      priority: 1,
      levels: [{
        label: "3区分",
        map: { none: "none", J1: "J", J2: "J", A1: "A", A2: "A", B1: "B_C", B2: "B_C", C1: "B_C", C2: "B_C" },
      }],
    },
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["障害自立度", "障害高齢者の日常生活自立度"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "econ.premium_band",
    label: "保険料段階（帯）",
    description: "第1号被保険者の保険料段階を3帯にしたもの。段階をそのままの数字では持ち込まない",
    valueType: "band",
    codes: { b1_3: "第1〜3段階", b4_6: "第4〜6段階", b7_: "第7段階以上" },
    role: "sensitive",
    generalization: { priority: 1, levels: [{ label: "削除", collapseTo: "*" }] },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["保険料段階"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "outcome.cert_new",
    label: "新規認定の発生",
    description: "当該年度に要支援・要介護の新規認定を受けた（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["新規認定", "認定申請区分"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "outcome.checkup_attended",
    label: "健診受診",
    description: "当該年度に健診を受診した（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["健診受診", "受診有無"],
    planTypes: [PLAN_TYPE],
  },
  {
    key: "outcome.hospitalized",
    label: "入院の発生",
    description: "当該年度に入院した（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["入院"],
    planTypes: [PLAN_TYPE],
  },
];
