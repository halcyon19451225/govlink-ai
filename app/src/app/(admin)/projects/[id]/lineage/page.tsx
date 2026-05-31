export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import LineageGraphClient from "./LineageGraphClient";

export default async function LineagePage({
  params,
}: {
  params: { id: string };
}) {
  const project = await queryOne<{ id: string; title: string }>(
    "SELECT id, title FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  return <LineageGraphClient project={project} projectId={params.id} />;
}
