// 旧「コストと効率性の評価」ページ。
//
// 案B-2 の統合により、効率性評価はプログラム評価の第5階層へ移設済み。
// この画面から新規作成すると、親の program_evaluations 行を持たない
// 孤立した cost_efficiency_records が増えてしまうため、恒久リダイレクトにする。
//
// 既存レコードはプログラム評価の「効率性評価」タブから参照・編集できる
// （同じ cost_efficiency_records を読んでいる）。
// 旧UI実装（CostEfficiencyClient.tsx）は移植元の記録として残置している。

import { redirect } from "next/navigation";

export default function CostEfficiencyPage({ params }: { params: { id: string } }) {
  redirect(`/projects/${params.id}/program-evaluation`);
}
