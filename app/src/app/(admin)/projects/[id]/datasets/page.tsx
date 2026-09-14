export const dynamic = "force-dynamic";

/**
 * データセット管理（D2）— 箱と版
 *
 * 設計: claude/coe-dataset-model.md §4・§12。画面内の説明文は src/content/manual/datasets.md と同じ趣旨で書く。
 * 属性辞書とキー種別は**分野に依存しない**（DB の3層＝コア／分野パック／テナント拡張から解決する）。
 */
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { queryOne } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { assertProjectPage } from "@/lib/tenant-page";
import { listDatasets, listKeyTypes, listTemplates, resolveDictionary } from "@/lib/dataset/service";
import { NORMALIZATION_STYLES } from "@/lib/dataset/keyTypes";
import { packFor } from "@/lib/dataset/domains";
import DatasetsClient from "./DatasetsClient";

interface ProjectRow {
  id: string;
  title: string;
  plan_type: string | null;
}

export default async function DatasetsPage({ params }: { params: { id: string } }) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする（claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const session = await getServerSession(authOptions);
  const municipalityId = session?.user?.municipalityId ?? "";

  const project = await queryOne<ProjectRow>("SELECT id, title, plan_type FROM projects WHERE id = $1", [params.id]);
  if (!project) notFound();

  const [datasets, templates, dictionary, keyTypes] = await Promise.all([
    listDatasets(project.id),
    listTemplates(project.plan_type),
    resolveDictionary(project.id, municipalityId),
    listKeyTypes(municipalityId),
  ]);
  const pack = packFor(project.plan_type);

  return (
    <DatasetsClient
      project={project}
      initialDatasets={datasets}
      templates={templates}
      dictionary={dictionary}
      domain={pack ? { planType: pack.planType, label: pack.label, reviewed: pack.reviewed } : null}
      keyTypes={keyTypes}
      normalizationStyles={NORMALIZATION_STYLES.map((s) => ({ ...s }))}
    />
  );
}
