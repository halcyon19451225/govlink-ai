/**
 * データセット（器）の型 — 設計: claude/coe-dataset-model.md §3〜§6
 *
 * ここにある型は、庁内の変換ツールと Coe の取込口の両方が使う。
 * **個人を特定しうる列は、どの型にも存在しない。**（氏名・住所・生年月日・電話・
 * 個人番号・宛名番号・被保険者番号は、変換ツールの入力までで消える）
 */

/** 箱の種別 */
export type DatasetKind = "aggregate" | "individual";

/** 集計データの列の役割 */
export type ColumnRole = "dimension" | "time" | "measure";

/** 集計データの列の型 */
export type ColumnType = "text" | "int" | "numeric" | "fiscal_year" | "year" | "month" | "date";

/** 集計データの箱が持つ列定義（1列分） */
export interface ColumnSpec {
  name: string;
  role: ColumnRole;
  type: ColumnType;
  /** dimension のとき、許容値を限定したい場合 */
  codes?: string[];
  required?: boolean;
}

/** 属性の値の型。**'text'（自由記述）は存在しない**（§5-1） */
export type AttributeValueType =
  | "code"
  | "band"
  | "int"
  | "numeric"
  | "bool"
  | "month"
  | "fiscal_year";

/**
 * 属性の役割。k 検定は quasi_identifier だけで数え、ℓ 検定は sensitive で数える。
 * outcome / exposure は数えない（数えると縦断データはほぼ全員ユニークになる。§13-1）
 */
export type AttributeRole = "quasi_identifier" | "sensitive" | "exposure" | "outcome" | "neutral";

/** 観測時点の粒度 */
export type TimeGranularity = "day" | "month" | "fiscal_year" | "static";

/** 粗化のはしごの1段。前段のコード → この段のコード */
export interface GeneralizationLevel {
  /** 段の名前（画面に出す） */
  label: string;
  /** 前段の値 → この段の値。載っていない値は不正として拒否 */
  map: Record<string, string>;
}

/** 粗化のはしご。level 0 は辞書の codes そのもの。最後まで上げても満たさなければ削除（行を抑制） */
export interface Generalization {
  levels: GeneralizationLevel[];
  /**
   * 複数の準識別子がある場合に、どれから先に粗くするか（小さいほど先）。
   * 情報量の少ない属性から先に粗くし、分析に効く属性を最後まで残す
   */
  priority: number;
}

/** 属性辞書の1件（§5-1 attribute_definitions と同形） */
export interface AttributeDefinition {
  key: string;
  label: string;
  description: string;
  valueType: AttributeValueType;
  /** code / band の許容値と表示名 */
  codes?: Record<string, string>;
  unit?: string;
  role: AttributeRole;
  generalization?: Generalization;
  timeGranularity: TimeGranularity;
  /** 既定は false。共通辞書で明示的に true にしたものだけ Coe に持ち込める */
  cloudAllowed: boolean;
  /** 標準EUC・KDB の項目名との対応候補（変換ツールのマッピング初期値） */
  sourceHints?: string[];
  planTypes?: string[];
}

/** 五つ組（§3）。値は型に応じて1つだけ入る */
export interface Observation {
  sid: string;
  attrKey: string;
  /** ISO 日付（YYYY-MM-DD）。month なら月初、fiscal_year なら年度開始日、static なら 1900-01-01 */
  observedAt: string;
  valueCode?: string;
  valueNum?: number;
  valueBool?: boolean;
}

/** 横持ちの1行（変換ツールの中間表現。sid は導出済み、直接識別子は既に無い） */
export interface WideRow {
  sid: string;
  /** attrKey → 正規化済みの値（code/band は文字列、数値は number、bool は boolean） */
  values: Record<string, string | number | boolean>;
}

/** 拒否の理由（値そのものは残さない） */
export type RejectReason =
  | "unknown_attr"
  | "not_cloud_allowed"
  | "invalid_code"
  | "invalid_number"
  | "invalid_bool"
  | "invalid_date"
  | "looks_like_my_number"
  | "missing_sid";

export interface RejectSummary {
  reason: RejectReason;
  attrKey?: string;
  count: number;
}
