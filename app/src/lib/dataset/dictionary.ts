/**
 * 属性辞書 — コア（分野中立）— 設計: claude/coe-dataset-model.md §5-1
 *
 * 「何の情報か」はここにあるキーに限る。**自由記述型は存在しない。**
 * 汎用性は辞書を増やして得る（スキーマは増やさない）。
 *
 * ★ **このファイルには特定の行政分野の語彙を書かない。**
 *   どの分野の計画でも意味が変わらない属性だけを置く。分野に固有の属性は
 *   `domains/<分野>.ts`（分野パック）へ、自治体に固有の属性はテナント拡張へ置く。
 *   `check:generic` がこの規律を機械で守る。
 *
 * role の意味:
 *   quasi_identifier … k 検定で数える。粗化のはしご（generalization）が必須
 *   sensitive        … ℓ 検定で数える（セル内で1値に偏っていないか）
 *   exposure/outcome … 数えない（縦断データの軌跡はほぼ固有になるため。§13-1）
 *   neutral          … どちらでもない
 *
 * cloudAllowed が false の属性は、辞書に載っていても変換ツールが出力しない。
 * localCodes が true の属性は、値の語彙を自治体が登録して初めて使える。
 */
import type { AttributeDefinition } from "./types";

export const DICTIONARY_VERSION = 2;

const AGE5 = [
  "u20", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59",
  "60-64", "65-69", "70-74", "75-79", "80-84", "85-89", "90-94", "95-99", "100+",
] as const;

const AGE5_TO_10: Record<string, string> = {
  u20: "u20",
  "20-24": "20-29", "25-29": "20-29", "30-34": "30-39", "35-39": "30-39",
  "40-44": "40-49", "45-49": "40-49", "50-54": "50-59", "55-59": "50-59",
  "60-64": "60-69", "65-69": "60-69", "70-74": "70-79", "75-79": "70-79",
  "80-84": "80-89", "85-89": "80-89", "90-94": "90+", "95-99": "90+", "100+": "90+",
};
const AGE10_TO_20: Record<string, string> = {
  u20: "u20", "20-29": "20-39", "30-39": "20-39", "40-49": "40-59", "50-59": "40-59",
  "60-69": "60-79", "70-79": "60-79", "80-89": "80+", "90+": "80+",
};

const HOUSE_SIZE: Record<string, string> = { s1: "1人", s2: "2人", s3_4: "3〜4人", s5: "5人以上" };
const INCOME_BAND: Record<string, string> = { low: "低", mid: "中", high: "高" };
const SUBJECT_STATUS: Record<string, string> = {
  active: "対象として在籍", moved_out: "転出", deceased: "死亡", out_of_scope: "対象外になった",
};

/**
 * コア辞書。**planTypes は必ず空**（どの分野でも出る）。
 */
export const CORE_DICTIONARY: readonly AttributeDefinition[] = [
  // ── 準識別子（k 検定の対象。はしご必須） ──────────────
  {
    key: "demo.age_band5",
    label: "年齢（5歳階級）",
    description: "基準日時点の年齢を5歳階級にしたもの。生年月日そのものは持ち込めない",
    valueType: "band",
    codes: Object.fromEntries(
      AGE5.map((b) => [b, b === "u20" ? "20歳未満" : b === "100+" ? "100歳以上" : `${b}歳`]),
    ),
    role: "quasi_identifier",
    generalization: {
      priority: 2,
      levels: [
        { label: "10歳階級", map: AGE5_TO_10 },
        { label: "20歳階級", map: AGE10_TO_20 },
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
    description: "M / F / X（その他・不明）",
    valueType: "code",
    codes: { M: "男性", F: "女性", X: "その他・不明" },
    role: "quasi_identifier",
    generalization: { priority: 3, levels: [{ label: "削除", collapseTo: "*" }] },
    timeGranularity: "static",
    cloudAllowed: true,
    sourceHints: ["性別"],
    planTypes: [],
  },
  {
    key: "demo.area",
    label: "地区",
    description:
      "居住地の区分。どんな区分を使うか（小学校区・支所管内・地域自治区など）は自治体ごとに違うため、値の語彙は自治体が登録する。町丁目より細かい区分は登録できない",
    valueType: "code",
    codes: {},
    localCodes: true,
    role: "quasi_identifier",
    generalization: { priority: 1, levels: [{ label: "全域", collapseTo: "*" }] },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["地区", "圏域", "区分"],
    planTypes: [],
  },
  {
    key: "house.size_band",
    label: "世帯人数（帯）",
    description: "基準日時点の同一世帯の人数",
    valueType: "band",
    codes: HOUSE_SIZE,
    role: "quasi_identifier",
    generalization: {
      priority: 2,
      levels: [{ label: "単身か否か", map: { s1: "s1", s2: "s2+", s3_4: "s2+", s5: "s2+" } }],
    },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["世帯人数", "世帯員数"],
    planTypes: [],
  },
  // ── 機微属性（ℓ 検定の対象） ─────────────────────────
  {
    key: "econ.income_band",
    label: "所得の段階（帯）",
    description:
      "所得・課税の区分を3段階に粗化したもの。どの区分を低・中・高に当てるかは自治体が決める（制度上の段階をそのまま持ち込まない）",
    valueType: "band",
    codes: INCOME_BAND,
    role: "sensitive",
    generalization: { priority: 1, levels: [{ label: "削除", collapseTo: "*" }] },
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["所得段階", "課税区分"],
    planTypes: [],
  },
  // ── 曝露（施策・事業を受けたか） ──────────────────────
  {
    key: "prog.participated",
    label: "事業への参加",
    description: "対象の事業・サービスに参加した（有無）",
    valueType: "bool",
    role: "exposure",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["参加", "参加歴", "受講"],
    planTypes: [],
  },
  {
    key: "prog.notified",
    label: "案内・勧奨の到達",
    description: "案内や勧奨が届いた（有無）。実験の割付と実際の到達を分けて見るために使う",
    valueType: "bool",
    role: "exposure",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["通知", "勧奨", "案内"],
    planTypes: [],
  },
  // ── アウトカム ────────────────────────────────────────
  {
    key: "outcome.service_used",
    label: "サービス・制度の利用",
    description: "当該期間にサービス・制度を利用した（有無）",
    valueType: "bool",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["利用", "受給"],
    planTypes: [],
  },
  {
    key: "outcome.cost_amount",
    label: "費用額（年額）",
    description: "当該年度に公費・保険等から支出された額の合計（円）",
    valueType: "int",
    unit: "円",
    role: "outcome",
    timeGranularity: "fiscal_year",
    cloudAllowed: true,
    sourceHints: ["費用", "支給額", "支出額"],
    planTypes: [],
  },
  // ── 追跡の打ち切り ────────────────────────────────────
  {
    key: "demo.status",
    label: "対象としての状態",
    description: "基準日時点で追跡の対象に含まれるか。転出・死亡・対象外は打ち切り（センサリング）として扱う",
    valueType: "code",
    codes: SUBJECT_STATUS,
    role: "neutral",
    timeGranularity: "month",
    cloudAllowed: true,
    sourceHints: ["異動事由", "資格喪失事由", "状態"],
    planTypes: [],
  },
  // ── 庁内でだけ使う（Coe に出ない例） ──────────────────
  {
    key: "id.address_code",
    label: "住所コード（庁内限定）",
    description: "地区（demo.area）を導くための入力。**Coe には出ない**",
    valueType: "code",
    codes: {},
    localCodes: true,
    role: "quasi_identifier",
    generalization: { priority: 0, levels: [{ label: "地区へ丸める", collapseTo: "*" }] },
    timeGranularity: "fiscal_year",
    cloudAllowed: false,
    sourceHints: ["住所コード", "町丁目コード"],
    planTypes: [],
  },
];

/** 値の語彙が未設定（localCodes で codes が空）なら、まだ使えない */
export function isUsable(def: AttributeDefinition): boolean {
  if (!def.cloudAllowed) return false;
  if ((def.valueType === "code" || def.valueType === "band") && Object.keys(def.codes ?? {}).length === 0) return false;
  return true;
}

export function findAttribute(
  key: string,
  dict: readonly AttributeDefinition[],
): AttributeDefinition | undefined {
  return dict.find((d) => d.key === key);
}

/**
 * 辞書を重ね合わせる。あとに来たものが前を**上書き**する。
 * 想定: コア → 分野パック → テナント拡張。
 * テナントは `demo.area` の codes を足すだけ、といった部分上書きもできる。
 */
export function mergeDictionaries(
  ...layers: Array<readonly AttributeDefinition[]>
): AttributeDefinition[] {
  const byKey = new Map<string, AttributeDefinition>();
  for (const layer of layers) {
    for (const d of layer) {
      const prev = byKey.get(d.key);
      byKey.set(d.key, prev ? { ...prev, ...d } : d);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

/** 辞書の構造検査（check:dataset とテナント拡張の登録時に使う） */
export function validateDictionary(dict: readonly AttributeDefinition[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of dict) {
    if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(d.key)) errors.push(`${d.key}: キーの形式が不正`);
    if (seen.has(d.key)) errors.push(`${d.key}: 重複`);
    seen.add(d.key);
    if ((d.valueType as string) === "text") errors.push(`${d.key}: 自由記述型は許可されない`);
    if (d.valueType === "code" || d.valueType === "band") {
      const hasCodes = Object.keys(d.codes ?? {}).length > 0;
      if (!hasCodes && !d.localCodes) errors.push(`${d.key}: code/band には codes が必要（自治体ごとに違うなら localCodes を立てる）`);
    }
    if (d.role === "quasi_identifier" && !d.generalization) {
      errors.push(`${d.key}: 準識別子には粗化のはしごが必要`);
    }
    if (d.generalization) {
      d.generalization.levels.forEach((lv, i) => {
        if (!lv.map && !lv.collapseTo) errors.push(`${d.key}: はしご第${i + 1}段に map も collapseTo も無い`);
      });
      // 値の語彙が分かっている属性は、はしごの各段が前段の全コードを写していること
      if (d.codes && Object.keys(d.codes).length > 0) {
        let prev = Object.keys(d.codes);
        d.generalization.levels.forEach((lv, i) => {
          if (lv.collapseTo) {
            prev = [lv.collapseTo];
            return;
          }
          const missing = prev.filter((c) => !(c in (lv.map ?? {})));
          if (missing.length) errors.push(`${d.key}: はしご第${i + 1}段に写像の無いコード: ${missing.join(",")}`);
          prev = Array.from(new Set(Object.values(lv.map ?? {})));
        });
      }
    }
  }
  return errors;
}
