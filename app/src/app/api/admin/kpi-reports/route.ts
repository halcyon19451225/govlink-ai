import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get("project_id");
  const status = req.nextUrl.searchParams.get("status");

  if (!projectId) {
    return NextResponse.json({ data: null, error: "project_id は必須です" }, { status: 400 });
  }

  const conditions = ["kr.project_id = $1"];
  const values: unknown[] = [projectId];
  let idx = 2;

  if (status) {
    conditions.push(`kr.status = $${idx++}`);
    values.push(status);
  }

  const reports = await query<{
    id: string;
    kpi_id: string;
    kpi_label: string;
    kpi_unit: string;
    reported_value: number;
    report_period: string;
    comment: string | null;
    status: string;
    reported_by: string;
    reported_by_name: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
  }>(
    `SELECT kr.id, kr.kpi_id, k.label AS kpi_label, k.unit AS kpi_unit,
            kr.reported_value::float, kr.report_period, kr.comment,
            kr.status, kr.reported_by, kr.reported_by_name,
            kr.reviewed_by, kr.reviewed_at::text, kr.created_at::text
     FROM kpi_reports kr
     JOIN kpis k ON k.id = kr.kpi_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY kr.created_at DESC`,
    values,
  );

  return NextResponse.json({ data: reports, error: null });
}

const postSchema = z.object({
  project_id: z.string().uuid("project_id が不正です"),
  kpi_id: z.string().uuid("kpi_id が不正です"),
  reported_value: z.number({ message: "報告値は数値である必要があります" }),
  report_period: z.string().min(1, "報告期間は必須です"),
  comment: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const userId = session.user?.id ?? "unknown";
  const userName = session.user?.name ?? session.user?.email ?? null;

  let raw: unknown;
  try { raw = await req.json(); } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const { project_id, kpi_id, reported_value, report_period, comment } = parsed.data;

  const rows = await query<{ id: string; created_at: string }>(
    `INSERT INTO kpi_reports
       (kpi_id, project_id, reported_by, reported_by_name, reported_value, report_period, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at::text`,
    [kpi_id, project_id, userId, userName, reported_value, report_period, comment ?? null],
  );

  return NextResponse.json({ data: rows[0] ?? null, error: null }, { status: 201 });
}
