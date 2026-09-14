export const dynamic = "force-dynamic";

/**
 * データセット管理（D2）— 箱と版
 * 設計: claude/coe-dataset-model.md §4・§12。画面内の説明文は src/content/manual/datasets.md と同じ趣旨で書く。
 */
import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { assertProjectPage } from "@/lib/tenant-page";
import { listDatasets, listTemplates } from "@/lib/dataset/service";
import { CARE_INSURANCE_DICTIONARY } from "@/lib/dataset/dictionary";
import DatasetsClient, { type DictionaryEntry } from "./DatasetsClient";

interface ProjectRow {
  id: string;
  title: string;
  plan_type: string | null;
}

export default async function DatasetsPage({ params }: { params: { id: string } }) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする（claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const project = await queryOne<ProjectRow>("SELECT id, title, plan_type FROM projects WHERE id = $1", [params.id]);
  if (!project) notFound();

  const [datasets, templates] = await Promise.all([listDatasets(project.id), listTemplates(project.plan_type)]);
  const dictionary: DictionaryEntry[] = CARE_INSURANCE_DICTIONARY.filter((d) => d.cloudAllowed).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    role: d.role,
    valueType: d.valueType,
  }));

  return <DatasetsClient project={project} initialDatasets={datasets} templates={templates} dictionary={dictionary} />;
}
