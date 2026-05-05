export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  status: string;
  department: string;
  slug: string;
}

interface KpiRow {
  id: string;
  label: string;
  target: number;
  current: number;
  unit: string;
}

interface PostRow {
  id: string;
  type: string;
  body: string;
  ai_summary: string | null;
  published_at: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const projects = await query<ProjectRow>(
      `SELECT p.id, p.title, p.description, p.status, m.name AS department, m.slug
       FROM projects p
       JOIN municipalities m ON m.id = p.municipality_id
       WHERE m.slug = $1
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [params.slug],
    );

    if (!projects[0]) {
      return NextResponse.json(
        { data: null, error: "政策が見つかりません" },
        { status: 404 },
      );
    }

    const project = projects[0];

    const [kpis, posts] = await Promise.all([
      query<KpiRow>(
        `SELECT id, label, target::float AS target, current::float AS current, unit
         FROM kpis WHERE project_id = $1 ORDER BY created_at`,
        [project.id],
      ),
      query<PostRow>(
        `SELECT id, type, body, ai_summary, published_at
         FROM posts
         WHERE project_id = $1 AND published_at IS NOT NULL
         ORDER BY published_at DESC`,
        [project.id],
      ),
    ]);

    return NextResponse.json({ data: { project, kpis, posts }, error: null });
  } catch (error) {
    console.error("GET /api/public/projects/[slug]:", error);
    return NextResponse.json(
      { data: null, error: "データの取得に失敗しました" },
      { status: 500 },
    );
  }
}
