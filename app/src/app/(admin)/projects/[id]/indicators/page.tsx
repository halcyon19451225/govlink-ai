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
import { resolveDictionary } from "@/lib/dataset/service";
import IndicatorsClient from "./IndicatorsClient";

interface ProjectRow {
  id: string;
  title: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
}

/**
 * 属性の値の語彙（D6）。経年比較型・クロス集計型の設定は「値」を並べる必要がある。
 * 手で打たせると綴り違いで黙って 0 件になるので、**選ばせる**。
 */
export interface AttributeChoice {
  key: string;
  label: string;
  valueType: string;
  codes: string[];
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
  const session = await getServerSession(authOptions);

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

  // 辞書は DB から解決する（コア＋その計画種別の分野パック＋この自治体の拡張）。
  // コード上の定数を直接読まない（分野を固定しないため。check:generic）
  let attributes: AttributeChoice[] = [];
  try {
    const dict = await resolveDictionary(project.id, session?.user?.municipalityId ?? "");
    attributes = dict.map((a) => ({
      key: a.key,
      label: a.label,
      valueType: a.valueType,
      codes: a.codes ? Object.keys(a.codes) : [],
    }));
  } catch {
    attributes = [];
  }

  return (
    <IndicatorsClient
      project={project}
      initialIndicators={indicators}
      datasets={datasets}
      attributes={attributes}
    />
  );
}
