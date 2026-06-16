export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s　]+/g, "_")
    .replace(/[^a-z0-9_\-]/g, "")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    || `cat_${Date.now()}`;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const all = req.nextUrl.searchParams.get("all") === "true";
  const rows = await query(
    `SELECT id, name, slug, description, plan_type, color, sort_order, is_active, created_at::text
     FROM knowledge_categories
     ${all ? "" : "WHERE is_active = true"}
     ORDER BY sort_order ASC, created_at ASC`,
  );

  return NextResponse.json({ data: rows, error: null });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const body = await req.json() as {
    name?: string;
    slug?: string;
    description?: string;
    plan_type?: string;
    color?: string;
    sort_order?: number;
  };

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ data: null, error: "カテゴリー名は必須です" }, { status: 400 });
  }

  // slug 生成・重複回避
  let slug = body.slug?.trim() || toSlug(name);
  const existing = await query<{ slug: string }>(
    `SELECT slug FROM knowledge_categories WHERE slug LIKE $1 || '%'`,
    [slug],
  );
  if (existing.some((r) => r.slug === slug)) {
    let n = 2;
    while (existing.some((r) => r.slug === `${slug}_${n}`)) n++;
    slug = `${slug}_${n}`;
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO knowledge_categories (name, slug, description, plan_type, color, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      name,
      slug,
      body.description?.trim() || null,
      body.plan_type?.trim() || null,
      body.color || "#0C447C",
      body.sort_order ?? 0,
    ],
  );

  return NextResponse.json({ data: rows[0], error: null }, { status: 201 });
}
