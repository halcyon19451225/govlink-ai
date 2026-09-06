export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";

type Params = { params: { id: string } };

/** API レスポンスの成果物ノード（循環参照なし） */
export interface LineageNode {
  id: string;
  module_id: string;
  artifact_type: string;
  artifact_record_id: string;
  derivation_note: string | null;
  created_at: string;
  updated_at: string;
  is_stale: boolean;
  stale_datasets: string[];
}

/** API レスポンスのエッジ（source → target の有向辺） */
export interface LineageEdge {
  source: string; // module_artifacts.id（上流）
  target: string; // module_artifacts.id（下流）
}

export interface LineageResponse {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

async function buildLineageFlat(projectId: string): Promise<LineageResponse> {
  // プロジェクト全成果物を取得
  const rows = await query<{
    id: string;
    module_id: string;
    artifact_type: string;
    artifact_record_id: string;
    source_artifact_ids: string[];
    source_datasets_snapshot: Record<string, string>;
    derivation_note: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, module_id, artifact_type, artifact_record_id::text,
            source_artifact_ids, source_datasets_snapshot,
            derivation_note, created_at::text, updated_at::text
     FROM module_artifacts
     WHERE project_id = $1
     ORDER BY created_at`,
    [projectId],
  );

  if (rows.length === 0) return { nodes: [], edges: [] };

  // 陳腐化チェック用: 現在の project_datasets.uploaded_at を取得
  const datasets = await query<{ dataset_def_id: string; uploaded_at: string }>(
    `SELECT dataset_def_id, uploaded_at::text FROM project_datasets WHERE project_id = $1`,
    [projectId],
  );
  const currentUploads: Record<string, string> = {};
  for (const ds of datasets) {
    currentUploads[ds.dataset_def_id] = ds.uploaded_at;
  }

  // 全 artifact ID のセット（存在チェック用）
  const idSet = new Set(rows.map((r) => r.id));

  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];

  for (const row of rows) {
    // 陳腐化チェック
    const staleDatasets: string[] = [];
    const snapshot = row.source_datasets_snapshot ?? {};
    for (const [defId, snapshotTime] of Object.entries(snapshot)) {
      if (currentUploads[defId] && currentUploads[defId] !== snapshotTime) {
        staleDatasets.push(defId);
      }
    }

    nodes.push({
      id: row.id,
      module_id: row.module_id,
      artifact_type: row.artifact_type,
      artifact_record_id: row.artifact_record_id,
      derivation_note: row.derivation_note,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_stale: staleDatasets.length > 0,
      stale_datasets: staleDatasets,
    });

    // source_artifact_ids からエッジを生成（存在するIDのみ）
    for (const srcId of row.source_artifact_ids ?? []) {
      if (idSet.has(srcId)) {
        edges.push({ source: srcId, target: row.id });
      }
    }
  }

  return { nodes, edges };
}

export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const artifactId = searchParams.get("artifactId") ?? undefined;

  // artifactId 指定時はプロジェクト帰属を確認
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

  const result = await buildLineageFlat(params.id);

  // artifactId 指定時は、そのノードと直接繋がるものだけに絞る
  if (artifactId) {
    const relatedIds = new Set<string>([artifactId]);
    for (const e of result.edges) {
      if (e.source === artifactId || e.target === artifactId) {
        relatedIds.add(e.source);
        relatedIds.add(e.target);
      }
    }
    return NextResponse.json({
      data: {
        nodes: result.nodes.filter((n) => relatedIds.has(n.id)),
        edges: result.edges.filter(
          (e) => relatedIds.has(e.source) && relatedIds.has(e.target),
        ),
      },
      error: null,
    });
  }

  return NextResponse.json({ data: result, error: null });
}
