export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

interface ArtifactRow {
  id: string;
  module_id: string;
  artifact_type: string;
  artifact_record_id: string;
  source_artifact_ids: string[];
  source_datasets_snapshot: Record<string, string>;
  derivation_note: string | null;
  created_at: string;
  updated_at: string;
}

interface ArtifactNode extends ArtifactRow {
  is_stale: boolean;
  stale_datasets: string[];
  upstream: ArtifactNode[];
  downstream: ArtifactNode[];
}

/** 全成果物を取得してインメモリでツリーを組み立てる */
async function buildLineageTree(
  projectId: string,
  rootArtifactId?: string,
): Promise<ArtifactNode[]> {
  // プロジェクト全成果物を取得
  const rows = await query<ArtifactRow>(
    `SELECT id, module_id, artifact_type, artifact_record_id::text,
            source_artifact_ids, source_datasets_snapshot,
            derivation_note, created_at::text, updated_at::text
     FROM module_artifacts
     WHERE project_id = $1
     ORDER BY created_at`,
    [projectId],
  );

  if (rows.length === 0) return [];

  // 現在の project_datasets.uploaded_at を取得（陳腐化検出用）
  const datasets = await query<{ dataset_def_id: string; uploaded_at: string }>(
    `SELECT dataset_def_id, uploaded_at::text FROM project_datasets WHERE project_id = $1`,
    [projectId],
  );
  const currentUploads: Record<string, string> = {};
  for (const ds of datasets) {
    currentUploads[ds.dataset_def_id] = ds.uploaded_at;
  }

  // ID → ArtifactNode のマップを構築（upstream/downstream は後から埋める）
  const nodeMap = new Map<string, ArtifactNode>();
  for (const row of rows) {
    const staleDatasets: string[] = [];
    const snapshot = row.source_datasets_snapshot ?? {};
    for (const [defId, snapshotTime] of Object.entries(snapshot)) {
      if (currentUploads[defId] && currentUploads[defId] !== snapshotTime) {
        staleDatasets.push(defId);
      }
    }
    nodeMap.set(row.id, {
      ...row,
      source_artifact_ids: row.source_artifact_ids ?? [],
      is_stale: staleDatasets.length > 0,
      stale_datasets: staleDatasets,
      upstream: [],
      downstream: [],
    });
  }

  // upstream / downstream を組み立てる
  for (const node of Array.from(nodeMap.values())) {
    for (const srcId of node.source_artifact_ids) {
      const src = nodeMap.get(srcId);
      if (src) {
        node.upstream.push(src);
        src.downstream.push(node);
      }
    }
  }

  if (rootArtifactId) {
    const root = nodeMap.get(rootArtifactId);
    return root ? [root] : [];
  }

  // ルートノード（上流がないもの）を返す
  return Array.from(nodeMap.values()).filter((n) => n.upstream.length === 0);

}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const artifactId = searchParams.get("artifactId") ?? undefined;

  // artifactId 指定時はそのノードが対象プロジェクトに属するか確認
  if (artifactId) {
    const exists = await queryOne(
      `SELECT id FROM module_artifacts WHERE id = $1 AND project_id = $2`,
      [artifactId, params.id],
    );
    if (!exists) {
      return NextResponse.json(
        { data: null, error: "指定された成果物が見つかりません" },
        { status: 404 },
      );
    }
  }

  const tree = await buildLineageTree(params.id, artifactId);

  return NextResponse.json({ data: tree, error: null });
}
