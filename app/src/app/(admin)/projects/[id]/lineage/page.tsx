export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import LineageGraphClient from "./LineageGraphClient";
import { assertProjectPage } from "@/lib/tenant-page";

export default async function LineagePage({
  params,
}: {
  params: { id: string };
}) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする
  // （claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  return <LineageGraphClient project={project} projectId={params.id} />;
}
