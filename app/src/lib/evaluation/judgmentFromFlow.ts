/**
 * 保存済みの判定経路（flow_decision_path）から、様式集の判定（図E1）へ橋を架ける。
 *
 * 現在デプロイされているフロー（fig7v2 / fig6v2）は、様式集の図E1が定める
 * 4つの問い（①目標到達 ②接近 ③初期アウトカム起因 ④a再現可能／④b財政効果率）
 * とは設問が一致しない。したがってここでは**分かる範囲だけ**を写し、
 * 足りなければ `judge()` は null を返す ＝ 判定保留として扱う。
 *
 * 判定保留は誤りではなく、様式集が定める正規の状態:
 *   「判定に必要なデータが揃わない場合は判定保留（どのルートにも進まず処遇を行わない。
 *     測定課題として記録し、次期に判定可能となる測定設計を計画に書き込む）」
 *
 * 図E1をそのまま実装したフロー（CA2-3改）に差し替えたら、
 * そちらは判定結果を直接持つので、この橋は互換のためだけに残る。
 */

import { judge, type JudgmentAnswers, type JudgmentResult } from "@/lib/evaluation/judgment";

export interface StoredAnswer {
  step_id: string;
  value?: string | null;
}

/** 図E1の回答が保存されていればそれを、無ければ既存フローから推し量る */
export function judgmentAnswersFromFlow(
  flowKey: string | undefined,
  answers: StoredAnswer[],
  stored?: Partial<JudgmentAnswers> | null,
): { answers: JudgmentAnswers | null; missing: string[] } {
  const pick = (id: string) => answers.find((a) => a.step_id === id)?.value ?? null;

  // 図E1をそのまま実装したフローの保存値が最優先
  if (stored?.q1) {
    const a: JudgmentAnswers = { q1: stored.q1 };
    if (stored.q2) a.q2 = stored.q2;
    if (stored.q3) a.q3 = stored.q3;
    if (stored.q4a) a.q4a = stored.q4a;
    if (stored.q4b) a.q4b = stored.q4b;
    return { answers: a, missing: missingOf(a) };
  }

  // 既存フローからの写し取り（分かるところまで）
  const isMeasure = flowKey === "fig7" || flowKey === "fig7v2";
  // 取組評価の「成果」は初期アウトカム（No.7）。アウトプット（target_met）ではない。
  const metStep = isMeasure ? "mid_met" : "outcome_initial_met";
  const met = pick(metStep);
  if (met !== "met" && met !== "not_met") return { answers: null, missing: ["①目標到達の判定"] };

  const a: JudgmentAnswers = { q1: met === "met" ? "met" : "not_met" };

  // ③ 初期アウトカム起因か
  if (isMeasure) {
    const cause = pick("caused_by_initial");
    // chain_failed / chain_broken … 取組（初期アウトカム）側に要因がある
    // external … 外部要因 ＝ 起因しない
    if (cause === "chain_failed" || cause === "chain_broken") a.q3 = "attributable";
    else if (cause === "external") a.q3 = "not_attributable";
  } else {
    const attr = pick("attributable");
    // partial（一部は取組の結果）／provisional_p（比較データ未取得の暫定P判定）は
    // 図E1の二択に落とせない。無理に寄せず、判定保留にする。
    if (attr === "attributable") a.q3 = "attributable";
    else if (attr === "not_attributable") a.q3 = "not_attributable";
  }

  return { answers: a, missing: missingOf(a) };
}

/** 判定に足りていない問いを列挙する（報告書・画面に理由として出す） */
export function missingOf(a: JudgmentAnswers): string[] {
  const missing: string[] = [];
  if (a.q1 === "not_met" && !a.q2) missing.push("②目標値に近づいているか（3か年の傾向）");
  if ((a.q1 === "met" || a.q2 === "approaching") && !a.q3)
    missing.push("③成果の変化は初期アウトカムに起因するか");
  if (a.q3 === "not_attributable" && !a.q4a) missing.push("④a 別の要因は再現可能か");
  if (a.q3 === "attributable" && !a.q4b) missing.push("④b 財政効果率は100%以上か");
  return missing;
}

/**
 * 年次評価（図6）の回答から「実行起因／論理起因」を切り分ける。
 *
 * 共通ヘッダ④が言うとおり、これは期末（主要施策評価）でNo.1のB欄の起点になる
 * **唯一の根拠**。だから年次評価の時点で必ず残しておく。
 */
export function causeTypeFromWorkFlow(answers: StoredAnswer[]): string {
  const pick = (id: string) => answers.find((a) => a.step_id === id)?.value ?? null;
  const implemented = pick("implemented");
  if (implemented === "not_done") return "実行（未実施）";
  if (implemented === "partial") return "実行（一部にとどまった）";

  const gap = pick("gap_cause");
  if (gap === "volume") return "実行（量が出ない）";
  if (gap === "reach") return "実行（対象に届いていない）";
  if (gap === "fit") return "論理（内容が課題に合っていない）";
  if (gap === "measure") return "測定（指標の設定に無理）";
  if (gap === "external") return "外部要因";

  // アウトプットは目標に達したが、初期アウトカムが動かなかった＝典型的な論理起因
  if (pick("target_met") === "met" && pick("outcome_initial_met") === "not_met") {
    return "論理（実施・産出されたが変化なし）";
  }
  return "—";
}

export function judgeFromFlow(
  flowKey: string | undefined,
  answers: StoredAnswer[],
  stored?: Partial<JudgmentAnswers> | null,
): { result: JudgmentResult | null; missing: string[] } {
  const { answers: a, missing } = judgmentAnswersFromFlow(flowKey, answers, stored);
  if (!a) return { result: null, missing };
  const result = judge(a);
  return { result, missing };
}
