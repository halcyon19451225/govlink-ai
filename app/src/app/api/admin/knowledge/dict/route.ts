export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { queryOne } from "@/lib/db";

// Tier1 + Tier2（自自治体）のマージ辞書を返す
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });

  const municipalityId = session.user?.municipalityId;

  const tier1 = await queryOne<{ dict_data: Record<string, unknown> }>(
    `SELECT dict_data FROM knowledge_dicts WHERE tier = 1 AND municipality_id IS NULL`,
  );

  const tier2 = municipalityId
    ? await queryOne<{ id: string; dict_data: Record<string, unknown> }>(
        `SELECT id, dict_data FROM knowledge_dicts WHERE tier = 2 AND municipality_id = $1`,
        [municipalityId],
      )
    : null;

  // マージ: Tier1をベースにTier2を重ねる
  const t1 = tier1?.dict_data as {
    sections?: unknown[]; global_terms?: Record<string, string>; version?: number
  } ?? { sections: [], global_terms: {}, version: 0 };
  const t2 = tier2?.dict_data as {
    sections?: unknown[]; global_terms?: Record<string, string>; version?: number
  } ?? { sections: [], global_terms: {} };

  const merged = {
    tier1_version: t1.version ?? 0,
    tier2_id: tier2?.id ?? null,
    sections: [...(t1.sections ?? []), ...(t2.sections ?? [])],
    global_terms: { ...(t1.global_terms ?? {}), ...(t2.global_terms ?? {}) },
  };

  return NextResponse.json({ data: merged, error: null });
}
