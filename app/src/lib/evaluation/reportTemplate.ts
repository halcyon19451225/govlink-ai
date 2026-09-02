/**
 * 評価報告書の様式（CA2-5・設計 claude/coe-ca2-design.md §9）
 *
 * アカウンタビリティの確保が両評価に共通する目的である以上、評価の結果は
 * 「第三者が読んで判断の筋道をたどれる文書」として出せなければならない。
 * このファイルは**様式の定義だけ**を持ち、データの取り出し（reportData.ts）と
 * docx の組み立て（reportDocx.ts）から切り離してある。
 *
 * ⚠ 様式は差し替え前提。
 *   踏襲する様式（「第10期計画 振り返りと課題 再編」で整理されたもの）が提供され次第、
 *   **このファイルの SECTIONS だけを書き替える**。データ取得と描画は触らなくてよい。
 *   PL2 で計画書の様式を後から差し替えられるようにしたのと同じ考え方。
 *
 * 欄の記号（A・B・C…）は様式が来たらそれに合わせる。現状は暫定で、
 * 図7-5 が言及する「報告書C欄（フレームワークを用いなかった理由）」のように
 * 欄で参照される運用に耐えるよう、記号を持てる構造にしてある。
 */

export type ReportKind = "work" | "measure";

/** 節の中身の種類 — reportDocx がこの種別で描き分ける */
export type ReportBlockKind =
  | "text" // 記述（複数段落）
  | "kv" // 見出し付きの1行項目の並び
  | "indicator_table" // 指標の実績表（基準値・目標・実績・判定・出所）
  | "path_table" // 判定経路（工程・問い・回答・補足）
  | "delegation_table" // 委任した／された課題
  | "work_rollup_table" // 取組評価のロールアップ（主要施策評価のみ）
  | "cost_table" // 年度別の事業費と財源
  | "benchmark_table" // 他団体比較（主要施策評価のみ）
  | "activity_table"; // 実施記録（No.5の内訳。取組評価のみ）

export interface ReportBlock {
  kind: ReportBlockKind;
  /** データが空のとき、節ごと省略するか（false なら「該当なし」と出す） */
  omitWhenEmpty?: boolean;
}

export interface ReportSection {
  /** 様式上の欄記号（A・B・C…）。様式提供後に合わせる */
  mark: string;
  heading: string;
  /** 節の趣旨。空欄のまま提出されないよう、報告書にも小さく刷る */
  note?: string;
  blocks: ReportBlock[];
}

export interface ReportForm {
  kind: ReportKind;
  /** 文書の標題（〔〕は生成時に置き換える） */
  title: string;
  subtitle: string;
  sections: ReportSection[];
}

/** 取組評価報告書（年次・取組単位） */
export const WORK_REPORT_FORM: ReportForm = {
  kind: "work",
  title: "取組評価報告書",
  subtitle: "年次評価（図6）の結果",
  sections: [
    {
      mark: "A",
      heading: "評価の対象と方法",
      note: "どの取組を、どの年度について、どの枠組みで評価したかを示す。",
      blocks: [{ kind: "kv" }],
    },
    {
      mark: "B",
      heading: "指標の実績",
      note: "判定に用いた指標の基準値・目標値・実績と、その出所。承認時点で凍結した値を印字する。",
      blocks: [{ kind: "indicator_table" }],
    },
    {
      mark: "C",
      heading: "実施の記録",
      note: "アクティビティ指標（No.5）の内訳。計画件数と完了件数をタスクの実績から集計したもの。",
      blocks: [{ kind: "activity_table", omitWhenEmpty: true }],
    },
    {
      mark: "D",
      heading: "判定の経路",
      note: "各工程の問いと回答。システム判定を担当者が覆した場合は、その事実も残す。",
      blocks: [{ kind: "path_table" }],
    },
    {
      mark: "E",
      heading: "所見・未達要因",
      note: "目標に達しなかった要因、体制上の制約、帰属の判断根拠など。",
      blocks: [{ kind: "text" }],
    },
    {
      mark: "F",
      heading: "次年度の扱いと改善策",
      note: "取組の継続・拡充・縮小・変更・終了の別と、担当者レベルで決めた改善策。",
      blocks: [{ kind: "text" }],
    },
    {
      mark: "G",
      heading: "主要施策評価へ委任した課題",
      note: "取組の改善だけでは解消できない課題。上位の評価で扱われる。",
      blocks: [{ kind: "delegation_table", omitWhenEmpty: false }],
    },
    {
      mark: "H",
      heading: "コスト",
      note: "当該年度の事業費と財源内訳。",
      blocks: [{ kind: "cost_table", omitWhenEmpty: true }],
    },
  ],
};

/** 主要施策評価報告書（計画期間・施策単位） */
export const MEASURE_REPORT_FORM: ReportForm = {
  kind: "measure",
  title: "主要施策評価報告書",
  subtitle: "計画期間評価（図7）の結果",
  sections: [
    {
      mark: "A",
      heading: "評価の対象と方法",
      note: "どの主要施策を、どの時点で、どの枠組みで評価したかを示す。",
      blocks: [{ kind: "kv" }],
    },
    {
      mark: "B",
      heading: "中間アウトカムの達成状況",
      note: "判定に用いた主要施策レベルの指標。承認時点で凍結した値を印字する。",
      blocks: [{ kind: "indicator_table" }],
    },
    {
      mark: "C",
      heading: "取組評価の集約",
      note: "この施策に属する取組の年次評価の結果。中間アウトカムとの連鎖を確かめる材料。",
      blocks: [{ kind: "work_rollup_table", omitWhenEmpty: false }],
    },
    {
      mark: "D",
      heading: "委任された課題への対応",
      note: "取組評価から委任された課題を、この評価でどう扱ったか（対応済み／次期へ引き継ぎ）。",
      blocks: [{ kind: "delegation_table", omitWhenEmpty: false }],
    },
    {
      mark: "E",
      heading: "コストと効率性",
      note: "年度別の事業費と財源、単位コスト、他団体との比較。",
      blocks: [
        { kind: "cost_table", omitWhenEmpty: true },
        { kind: "benchmark_table", omitWhenEmpty: true },
      ],
    },
    {
      mark: "F",
      heading: "判定の経路",
      note: "各工程の問いと回答。システム判定を担当者が覆した場合は、その事実も残す。",
      blocks: [{ kind: "path_table" }],
    },
    {
      mark: "G",
      heading: "次期計画における処遇",
      note: "継続・改変・統合・廃止の別とその理由。次期計画の主要施策形成の出発点になる。",
      blocks: [{ kind: "text" }],
    },
    {
      mark: "H",
      heading: "次期計画への引き継ぎ",
      note: "計画全体のロジックモデルの見直しが要る課題と、引き継ぎ事項。次期のニーズ評価・セオリー評価の入力になる。",
      blocks: [{ kind: "text" }, { kind: "delegation_table", omitWhenEmpty: false }],
    },
  ],
};

export function formOf(kind: ReportKind): ReportForm {
  return kind === "work" ? WORK_REPORT_FORM : MEASURE_REPORT_FORM;
}

/** 様式のバージョン。差し替えたら上げる（報告書のフッタに刷る） */
export const REPORT_FORM_VERSION = "暫定様式 v1（2026-09）";
