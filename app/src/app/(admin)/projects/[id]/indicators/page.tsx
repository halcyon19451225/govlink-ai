export const dynamic = "force-dynamic";

/**
 * 指標管理（D4）— 指標の一覧・設定・履歴
 *
 * 設計: claude/coe-dataset-model.md §9。画面内の説明文は src/content/manual/indicators.md と同じ趣旨で書く。
 * 指標は**分野に依存しない**（見るのはデータセットの列・属性で、分野固有の語彙はここに持たない）。
 */
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { query, queryOne } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { assertProjectPage } from "@/lib/tenant-page";
import { listIndicators } from "@/lib/indicator/service";
import IndicatorsClient from "./IndicatorsClient";

interface ProjectRow {
  id: string;
  title: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
}

export interface DatasetChoice {
  id: string;
  name: string;
  kind: "aggregate" | "individual";
  schema: unknown;
  time_granularity: string;
  latest_as_of: string | null;
  version_count: number;
}

export default async function IndicatorsPage({ params }: { params: { id: string } }) {
  // テナント境界。他自治体の政策 UUID を直接開かれても 404 にする（claude/coe-tenant-isolation.md A-3）
  await assertProjectPage(params.id);
  await getServerSession(authOptions);

  const project = await queryOne<ProjectRow>(
    "SELECT id, title, plan_start_date::text, plan_end_date::text FROM projects WHERE id = $1",
    [params.id],
  );
  if (!project) notFound();

  const [indicators, datasets] = await Promise.all([
    listIndicators(project.id),
    query<DatasetChoice>(
      `SELECT d.id, d.name, d.kind, d.schema, d.time_granularity,
              (SELECT max(v.as_of)::text FROM dataset_versions v
                WHERE v.dataset_id = d.id AND v.status = 'validated') AS latest_as_of,
              (SELECT count(*)::int FROM dataset_versions v
                WHERE v.dataset_id = d.id AND v.status = 'validated') AS version_count
         FROM datasets d WHERE d.project_id = $1 ORDER BY d.created_at`,
      [project.id],
    ),
  ]);

  return <IndicatorsClient project={project} initialIndicators={indicators} datasets={datasets} />;
}
