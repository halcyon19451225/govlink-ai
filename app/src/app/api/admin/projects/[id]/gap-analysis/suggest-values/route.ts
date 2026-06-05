export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Anthropic from "@anthropic-ai/sdk";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { downloadFromStorage } from "@/lib/supabase-storage";
import { requireModulePermission } from "@/lib/permissions";

type Params = { params: { id: string } };

const MAX_BYTES = 60_000;

async function fetchCsvText(storagePath: string): Promise<string | null> {
  try {
    const buffer = (await downloadFromStorage("datasets", storagePath)).slice(0, MAX_BYTES);
    const sample = buffer.subarray(0, 256);
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i]!;
      if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
    }
    if (nonPrintable / sample.length > 0.15) return null;
    return buffer.toString("utf-8");
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const deny = await requireModulePermission(session, params.id, "gap_analysis", "view");
  if (deny) return deny;

  // プロジェクトのKPI一覧を取得
  const kpis = await query<{ id: string; label: string; unit: string }>(
    `SELECT id, label, unit FROM kpis WHERE project_id = $1 ORDER BY created_at`,
    [params.id]
  );

  if (kpis.length === 0) {
    return NextResponse.json({ data: null, error: "KPIが設定されていません" }, { status: 400 });
  }

  // データセットを取得
  const datasets = await query<{
    id: string; dataset_def_id: string; file_name: string;
    storage_path: string; survey_year: number | null;
  }>(
    `SELECT id, dataset_def_id, file_name, storage_path, survey_year
     FROM project_datasets WHERE project_id = $1`,
    [params.id]
  );

  if (datasets.length === 0) {
    return NextResponse.json({ data: null, error: "データセットが登録されていません" }, { status: 400 });
  }

  // CSVコンテンツを取得
  const csvParts: string[] = [];
  for (const ds of datasets) {
    const text = await fetchCsvText(ds.storage_path);
    if (text) {
      csvParts.push(`=== ${ds.file_name} (${ds.survey_year ?? "年度不明"}) ===\n${text}`);
    }
  }

  if (csvParts.length === 0) {
    return NextResponse.json({ data: null, error: "読み取れるデータセットがありません" }, { status: 400 });
  }

  const indicatorList = kpis.map((k, i) => `${i + 1}. ${k.label}（単位: ${k.unit || "—"}）`).join("\n");
  const datasetText = csvParts.join("\n\n").slice(0, 80_000);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `以下の指標について、データセットから現状値を抽出してください。
読み取れない指標は null としてください。

【指標リスト】
${indicatorList}

【データセット】
${datasetText}

以下のJSON形式のみで回答してください（説明文不要）:
{
  "values": [
    {
      "indicator_name": "指標名（指標リストと同じ表記）",
      "current_value": 数値 または null,
      "source": "どのデータセットの何行目/何欄から読み取ったか（簡潔に）"
    }
  ]
}`,
    }],
  });

  const raw = message.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  type ExtractedValue = { indicator_name: string; current_value: number | null; source: string };
  const extracted = (JSON.parse(raw) as { values: ExtractedValue[] }).values;

  // KPI IDと照合
  const results = kpis.map((kpi) => {
    const match = extracted.find(
      (e) => e.indicator_name.includes(kpi.label) || kpi.label.includes(e.indicator_name)
    );
    return {
      kpi_id: kpi.id,
      indicator_name: kpi.label,
      current_value: match?.current_value ?? null,
      source: match?.source ?? null,
    };
  });

  return NextResponse.json({ data: results, error: null });
}
