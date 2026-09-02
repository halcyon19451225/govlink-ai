export const dynamic = "force-dynamic";

/**
 * 次期計画への反映（収束工程・Act）— 様式H1〜H4・G1〜G4 の器。
 *
 * 期末評価（主要施策評価・fig7e1）の結果を次期計画へ流し込む工程。
 * 転記ゼロ原則: H1・G1・G4①〜⑦・G2 は評価が保存した判定・処遇から自動生成し、
 * 手入力は理由書（H4）・G4⑧〜⑫・反映箇所（G1-8）・注記だけにする。
 * 現行計画の施策データ（施策構築の内容）はここから書き換えない。
 */

import { notFound } from "next/navigation";
import { buildH1Data, buildReflectionData } from "@/lib/evaluation/reflectionData";
import PlanReflectionClient from "./PlanReflectionClient";

export default async function PlanReflectionPage({ params }: { params: { id: string } }) {
  const [h1, refl] = await Promise.all([buildH1Data(params.id), buildReflectionData(params.id)]);
  if (!h1 || !refl) notFound();
  return <PlanReflectionClient projectId={params.id} h1={h1} initialReflection={refl} />;
}
