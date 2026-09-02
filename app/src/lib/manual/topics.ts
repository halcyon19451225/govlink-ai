/**
 * メニュー別マニュアルの索引（M1 第2.5部）— 純粋・テスト可能
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * どのメニューにマニュアルがあるべきか（トピックID・表示名・画面パス）はここに集約する。
 * トピックID = マニュアルファイル名（app/src/content/manual/<id>.md）。
 * HelpButton・/manual・check:manual はここだけを参照する。
 *
 * マニュアルの位置づけ（設計 第2.5部）:
 *   ①利用者の操作マニュアルであると同時に、
 *   ②改修時にユーザーとClaudeが「現状」を共有する正本。
 *   リポジトリ内に置き、コードと同じコミットで版管理する
 *   （経緯=プロジェクトMD / 現状=このマニュアル、の分業）。
 */

export interface HelpTopic {
  /** マニュアルファイル名（英数ハイフンのみ — パス操作の安全性のため検証に使う） */
  id: string;
  label: string;
  /** 画面のパス（プロジェクト配下は /projects/[id]/ 起点） */
  menuPath: string;
  /** P/D/C/A/管理 の区分（目次のグルーピング） */
  section: "P" | "D" | "C" | "A" | "admin";
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  // P: 計画
  { id: "overview", label: "計画概要", menuPath: "/projects/[id]", section: "P" },
  { id: "datasets", label: "データセット管理", menuPath: "/projects/[id]/datasets", section: "P" },
  { id: "gap-analysis", label: "ギャップ分析", menuPath: "/projects/[id]/gap-analysis", section: "P" },
  { id: "asis-analysis", label: "現状整理(As-Is)", menuPath: "/projects/[id]/asis-analysis", section: "P" },
  { id: "issue-hypothesis", label: "課題仮説設定", menuPath: "/projects/[id]/issue-hypothesis", section: "P" },
  { id: "measure-design", label: "施策構築(EBPM)", menuPath: "/projects/[id]/measure-design", section: "P" },
  { id: "logic-model", label: "ロジックモデル", menuPath: "/projects/[id]/logic-model", section: "P" },
  { id: "evidences", label: "エビデンス管理", menuPath: "/projects/[id]/evidences", section: "P" },
  { id: "schedule", label: "スケジュール設定", menuPath: "/projects/[id]/schedule", section: "P" },
  { id: "pdca", label: "PDCAサイクル全体図", menuPath: "/projects/[id]/pdca", section: "P" },
  { id: "plan-document", label: "計画書の調製", menuPath: "/projects/[id]/plan-document", section: "P" },
  // D: 実行
  { id: "service-volume", label: "サービス見込量", menuPath: "/projects/[id]/service-volume", section: "D" },
  { id: "kpi-report", label: "KPI・進捗報告", menuPath: "/projects/[id]/kpi-report", section: "D" },
  { id: "documents", label: "ドキュメント管理", menuPath: "/projects/[id]/documents", section: "D" },
  // C: 評価
  { id: "report-requests", label: "実績報告依頼", menuPath: "/projects/[id]/report-requests", section: "C" },
  { id: "work-evaluation", label: "取組評価（年次）", menuPath: "/projects/[id]/work-evaluation", section: "C" },
  { id: "measure-evaluation", label: "主要施策評価（計画期間）", menuPath: "/projects/[id]/measure-evaluation", section: "C" },
  { id: "program-evaluation", label: "プログラム評価", menuPath: "/projects/[id]/program-evaluation", section: "C" },
  { id: "ebpm", label: "EBPMダッシュボード", menuPath: "/projects/[id]/ebpm", section: "C" },
  { id: "lineage", label: "リネージグラフ", menuPath: "/projects/[id]/lineage", section: "C" },
  // A: 改善
  { id: "plan-reflection", label: "次期計画への反映", menuPath: "/projects/[id]/plan-reflection", section: "A" },
  { id: "improvement-actions", label: "改善アクション", menuPath: "/projects/[id]/improvement-actions", section: "A" },
  { id: "self-evaluation", label: "自己評価シート", menuPath: "/projects/[id]/self-evaluation", section: "A" },
  { id: "post", label: "AI改善提案", menuPath: "/projects/[id]/post", section: "A" },
  { id: "kpi-summary", label: "KPIサマリー", menuPath: "/projects/[id]/kpi-summary", section: "A" },
  { id: "handover-intake", label: "前期引き継ぎの取り込み", menuPath: "/projects/[id]/handover-intake", section: "A" },
  // 管理（/ordo-admin ほか）
  { id: "ordo-corpus", label: "コーパス管理（Ordo）", menuPath: "/ordo-admin/corpus", section: "admin" },
  { id: "ordo-ai", label: "独自AI管理（Ordo）", menuPath: "/ordo-admin/ai", section: "admin" },
] as const;

/** 共通ページ「図の読み方」のファイル名（トピック外・全マニュアルの前提） */
export const CONVENTIONS_ID = "_conventions";

export const SECTION_LABELS: Record<HelpTopic["section"], string> = {
  P: "P: 計画",
  D: "D: 実行",
  C: "C: 評価",
  A: "A: 改善",
  admin: "運営管理",
};

/**
 * マニュアルが「必須」のトピック（check:manual が不在を失敗にする集合）。
 * M3で**全トピック必須**になった — 以後、新しいメニューを HELP_TOPICS に足すと
 * マニュアルを書くまで check が失敗する（DoD: 実装とマニュアルは同じコミットで揃える）。
 */
export const REQUIRED_MANUALS: readonly string[] = HELP_TOPICS.map((t) => t.id);

const SAFE_ID = /^[a-z0-9-]+$/;

/** パス操作に使ってよいIDか（ディレクトリトラバーサル防止 — _conventions も許可） */
export function isValidTopicId(id: string): boolean {
  return id === CONVENTIONS_ID || (SAFE_ID.test(id) && HELP_TOPICS.some((t) => t.id === id));
}

export function topicOf(id: string): HelpTopic | null {
  return HELP_TOPICS.find((t) => t.id === id) ?? null;
}
