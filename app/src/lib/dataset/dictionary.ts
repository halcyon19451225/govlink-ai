/**
 * 属性辞書（Coe 共通辞書）— 設計: claude/coe-dataset-model.md §5-1
 *
 * 「何の情報か」はここにあるキーに限る。**自由記述型は存在しない。**
 * 汎用性は辞書を増やして得る（スキーマは増やさない）。介護保険の初期辞書は
 * claude/coe-cohort-etl-plan.md §3-2 の粗化表をそのまま辞書化したもの。
 *
 * role の意味:
 *   quasi_identifier … k 検定で数える。粗化のはしご（generalization）が必須
 *   sensitive        … ℓ 検定で数える（セル内で1値に偏っていないか）
 *   exposure/outcome … 数えない（縦断データの軌跡はほぼ固有になるため。§13-1）
 *   neutral          … どちらでもない
 *
 * cloudAllowed が false の属性は、辞書に載っていても変換ツールが出力しない。
 * 共通辞書で明示的に true にしたものだけが Coe に届く。
 */
import type { AttributeDefinition } from "./types";

export const DICTIONARY_VERSION = 1;

const AGE5 = [
  "u40",
  "40-44", "45-49", "50-54", "55-59", "60-64", "65-69", "70-74", "75-79",
  "80-84", "85-89", "90-94", "95-99", "100+",
] as const;

const AGE5_TO_10: Record<string, string> = {
  u40: "u40",
  "40-44": "40-49", "45-49": "40-49", "50-54": "50-59", "55-59": "50-59",
  "60-64": "60-69", "65-69": "60-69", "70-74": "70-79", "75-79": "70-79",
  "80-84": "80-89", "85-89": "80-89", "90-94": "90+", "95-99": "90+", "100+": "90+",
};
const AGE10_TO_ELDERLY: Record<string, string> = {
  u40: "u65", "40-49": "u65", "50-59": "u65", "60-69": "u65_or_65-74",
  "70-79": "65-74_or_75+", "80-89": "75+", "90+": "75+",
};

const CARE_LEVEL: Record<string, string> = {
  none: "非該当", target: "事業対象者",
  support1: "要支援1", support2: "要支援2",
  care1: "要介護1", care2: "要介護2", care3: "要介護3", care4: "要介護4", care5: "要介護5",
};
const CARE_LEVEL_TO_5: Record<string, string> = {
  none: "none", target: "target", support1: "support", support2: "support",
  care1: "care12", care2: "care12", care3: "care345", care4: "care345", care5: "care345",
};
const CARE5_TO_2: Record<string, string> = {
  none: "no_cert", target: "no_cert", support: "cert", care12: "cert", care345: "cert",
};

function all(codes: Record<string, string>, to: string): Record<string, string> {
  return Object.fromEntries(Object.keys(codes).map((k) => [k, to]));
}

const AREA_CODES = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`area${String(i + 1).padStart(2, "0")}`, `圏域${i + 1}`]),
);

export const CARE_INSURANCE_DICTIONARY: readonly AttributeDefinition[] = [
  // ── 準識別子（k 検定の対象。はしご必須） ──────────────
  {
    key: "demo.age_band5",
    label: "年齢（5歳階級）",
    description: "基準日時点の年齢を5歳階級にしたもの。生年月日そのものは持ち込めない",
    valueType: "band",
    codes: Object.fromEntries(AGE5.map((b) => [b, b === "u40" ? "40歳未満" : b === "100+" ? "100歳以上" : `${b}歳`])),
    role: "quasi_identifier",
    generalization: {
      priority: 2,
      levels: [
        { label: "10歳階級", map: AGE5_TO_10 },
        { label: "前期／後期", map: AGE10_TO_ELDERLY },
      ],
    },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["生年月日", "年齢"],
    planTypes: [],
  },
  {
    key: "demo.sex",
    label: "性別",
    description: "M / F / X",
    valueType: "code",
    codes: { M: "男性", F: "女性", X: "その他・不明" },
    role: "quasi_identifier",
    generalization: { priority: 3, levels: [{ label: "削除", map: { M: "*", F: "*", X: "*" } }] },
    timeGranularity: "static",
    cloudAllowed: true,
    sourceHints: ["性別"],
  },
  {
    key: "demo.area",
    label: "日常生活圏域",
    description: "居住地の日常生活圏域。町丁目より細かい区分は持ち込めない（テナント拡張で圏域名を定義する）",
    valueType: "code",
    codes: AREA_CODES,
    role: "quasi_identifier",
    generalization: { priority: 1, levels: [{ label: "全域", map: all(AREA_CODES, "*") }] },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["圏域", "日常生活圏域", "地区"],
  },
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
        { label: "認定有無", map: CARE5_TO_2 },
      ],
    },
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["要介護度", "認定区分", "要介護状態区分"],
  },
  {
    key: "house.type",
    label: "世帯類型",
    description: "独居／高齢者のみ世帯／同居あり",
    valueType: "code",
    codes: { alone: "独居", elderly_only: "高齢者のみ", with_others: "同居あり" },
    role: "quasi_identifier",
    generalization: {
      priority: 2,
      levels: [{ label: "独居か否か", map: { alone: "alone", elderly_only: "not_alone", with_others: "not_alone" } }],
    },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["世帯類型", "世帯構成"],
  },
  // ── 機微属性（ℓ 検定の対象） ─────────────────────────
  {
    key: "econ.premium_band",
    label: "保険料段階（帯）",
    description: "第1号保険料の所得段階を3帯にしたもの",
    valueType: "band",
    codes: { b1_3: "第1〜3段階", b4_6: "第4〜6段階", b7_: "第7段階以上" },
    role: "sensitive",
    generalization: { priority: 1, levels: [{ label: "削除", map: { b1_3: "*", b4_6: "*", b7_: "*" } }] },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["保険料段階", "所得段階"],
  },
  {
    key: "health.dementia_level",
    label: "認知症高齢者の日常生活自立度",
    description: "認定調査・主治医意見書の区分",
    valueType: "code",
    codes: { none: "自立", I: "Ⅰ", IIa: "Ⅱa", IIb: "Ⅱb", IIIa: "Ⅲa", IIIb: "Ⅲb", IV: "Ⅳ", M: "M" },
    role: "sensitive",
    generalization: {
      priority: 1,
      levels: [{ label: "3区分", map: { none: "none", I: "I_II", IIa: "I_II", IIb: "I_II", IIIa: "III+", IIIb: "III+", IV: "III+", M: "III+" } }],
    },
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["認知症自立度", "認知症高齢者の日常生活自立度"],
  },
  {
    key: "health.adl_level",
    label: "障害高齢者の日常生活自立度",
    description: "認定調査・主治医意見書の区分",
    valueType: "code",
    codes: { none: "自立", J1: "J1", J2: "J2", A1: "A1", A2: "A2", B1: "B1", B2: "B2", C1: "C1", C2: "C2" },
    role: "sensitive",
    generalization: {
      priority: 1,
      levels: [{ label: "3区分", map: { none: "none", J1: "J", J2: "J", A1: "A", A2: "A", B1: "B_C", B2: "B_C", C1: "B_C", C2: "B_C" } }],
    },
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["障害自立度", "障害高齢者の日常生活自立度"],
  },
  // ── 曝露（施策への参加等） ────────────────────────────
  {
    key: "prog.participated",
    label: "事業への参加歴",
    description: "対象事業に参加した（有無）",
    valueType: "bool",
    role: "exposure",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["参加", "参加歴", "利用歴"],
  },
  // ── アウトカム ────────────────────────────────────────
  {
    key: "outcome.cert_new",
    label: "新規認定の発生",
    description: "当該年度に要支援・要介護の新規認定を受けた（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["新規認定", "認定申請区分"],
  },
  {
    key: "outcome.checkup_attended",
    label: "健診受診",
    description: "当該年度に特定健診等を受診した（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["健診受診", "受診有無"],
  },
  {
    key: "outcome.benefit_amount",
    label: "介護給付費（年額）",
    description: "当該年度の介護給付費の合計（円）",
    valueType: "int",
    unit: "円",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["給付費", "給付額"],
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
  },
  {
    key: "demo.status",
    label: "資格の状態",
    description: "基準日時点で、在住／転出／死亡のどれか。追跡の打ち切り（センサリング）に使う",
    valueType: "code",
    codes: { active: "在住", moved_out: "転出", deceased: "死亡" },
    role: "neutral",
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["資格喪失事由", "異動事由"],
  },
  // ── 庁内でだけ使う（Coe に出ない例） ──────────────────
  {
    key: "id.address_code",
    label: "町丁目コード（庁内限定）",
    description: "日常生活圏域（demo.area）を導くための入力。**Coe には出ない**",
    valueType: "code",
    codes: {},
    role: "quasi_identifier",
    generalization: { priority: 0, levels: [] },
    timeGranularity: "fiscal_year",
    cloudAllowed: false,
    sourceHints: ["町丁目コード", "住所コード"],
  },
];

export function findAttribute(
  key: string,
  dict: readonly AttributeDefinition[] = CARE_INSURANCE_DICTIONARY,
): AttributeDefinition | undefined {
  return dict.find((d) => d.key === key);
}

/** 辞書の構造検査（check:dataset とテナント拡張の登録時に使う） */
export function validateDictionary(dict: readonly AttributeDefinition[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of dict) {
    if (!/^[a-z]+\.[a-z0-9_]+$/.test(d.key)) errors.push(`${d.key}: キーの形式が不正`);
    if (seen.has(d.key)) errors.push(`${d.key}: 重複`);
    seen.add(d.key);
    if ((d.valueType as string) === "text") errors.push(`${d.key}: 自由記述型は許可されない`);
    if ((d.valueType === "code" || d.valueType === "band") && !d.codes) {
      errors.push(`${d.key}: code/band には codes が必要`);
    }
    if (d.role === "quasi_identifier" && !d.generalization) {
      errors.push(`${d.key}: 準識別子には粗化のはしごが必要`);
    }
    if (d.generalization && d.codes) {
      // はしごの各段が前段の全コードを写していること
      let prev = Object.keys(d.codes);
      d.generalization.levels.forEach((lv, i) => {
        const missing = prev.filter((c) => !(c in lv.map));
        if (missing.length) errors.push(`${d.key}: はしご第${i + 1}段に写像の無いコード: ${missing.join(",")}`);
        prev = Array.from(new Set(Object.values(lv.map)));
      });
    }
  }
  return errors;
}
