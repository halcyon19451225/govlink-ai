export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { aiCreateMessage } from "@/lib/ai/gateway";
import { authOptions } from "@/lib/auth";
import { requireProjectAccess } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { getKnowledgeContext } from "@/lib/knowledge-context";
import { requireModulePermission } from "@/lib/permissions";
import { downloadFromStorage } from "@/lib/storage";

type Params = { params: { id: string } };

const bodySchema = z.union([
  z.object({ gap_ids: z.array(z.string()).min(1) }),
  z.object({ from_datasets: z.literal(true) }),
]);

const MAX_BYTES = 60_000;

async function fetchStorageAsText(storagePath: string): Promise<string | null> {
  try {
    const buffer = (await downloadFromStorage("datasets", storagePath)).slice(0, MAX_BYTES);
    // バイナリファイル（Excel等）を簡易判定
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
  // テナント境界。URL の project id が自分の自治体のものか確認する
  // （claude/coe-tenant-isolation.md A-4）。拒否は 404 で、存在を漏らさない
  const outOfTenant = await requireProjectAccess(session, params.id);
  if (outOfTenant) return outOfTenant;
  const deny = await requireModulePermission(session, params.id, "gap_analysis", "edit");
  if (deny) return deny;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: "リクエスト本文が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "入力が不正です" },
      { status: 400 },
    );
  }

  const aiCtx = { taskType: "analysis.gap", projectId: params.id } as const;

  // ── モード1: データセットから自動抽出・gap_analyses 登録 ──
  if ("from_datasets" in parsed.data) {
    const datasets = await query<{
      id: string;
      dataset_def_id: string;
      file_name: string;
      s3_key: string;
      survey_year: number | null;
      display_name: string;
      description: string;
    }>(
      `SELECT pd.id, pd.dataset_def_id, pd.file_name, pd.s3_key, pd.survey_year,
              dd.display_name, dd.description
       FROM project_datasets pd
       JOIN dataset_definitions dd ON dd.id = pd.dataset_def_id
       WHERE pd.project_id = $1
       ORDER BY pd.uploaded_at DESC`,
      [params.id],
    );

    if (datasets.length === 0) {
      return NextResponse.json(
        { data: null, error: "アップロード済みデータセットがありません" },
        { status: 400 },
      );
    }

    // Storage から各ファイルをテキストとして取得
    const datasetContents: Array<{
      def_id: string;
      display_name: string;
      description: string;
      file_name: string;
      survey_year: number | null;
      content: string;
    }> = [];

    for (const ds of datasets) {
      const content = await fetchStorageAsText(ds.s3_key);
      if (content) {
        datasetContents.push({
          def_id: ds.dataset_def_id,
          display_name: ds.display_name,
          description: ds.description,
          file_name: ds.file_name,
          survey_year: ds.survey_year,
          content: content.slice(0, 8_000),
        });
      }
    }

    if (datasetContents.length === 0) {
      return NextResponse.json(
        { data: null, error: "データセットファイルの読み込みに失敗しました（Storageアクセスエラーまたは非テキストファイルのみ）" },
        { status: 500 },
      );
    }

    const datasetText = datasetContents
      .map(
        (d) =>
          `## ${d.display_name}（${d.file_name}）\n` +
          `説明: ${d.description}\n` +
          `調査年度: ${d.survey_year ?? "不明"}\n\n` +
          d.content,
      )
      .join("\n\n---\n\n");

    const hasMieruka = datasetContents.some((d) => d.def_id === "mieruka_export");

    const message = await aiCreateMessage(aiCtx, {
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools: [
        {
          name: "create_gap_analyses",
          description:
            "各データセットから抽出したギャップ分析データを構造化して返します。",
          input_schema: {
            type: "object",
            properties: {
              gaps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    indicator_name: {
                      type: "string",
                      description: "指標名（例: 要介護認定率）",
                    },
                    indicator_unit: {
                      type: "string",
                      description: "単位（例: %）",
                    },
                    data_source: {
                      type: "string",
                      description:
                        "データソースカテゴリ（介護保険事業 / ニーズ調査 / 認定状況 / サービス利用 / その他）",
                    },
                    current_value: {
                      type: "number",
                      description: "現状値（数値のみ）",
                    },
                    current_year: {
                      type: "integer",
                      description: "現状値の年度（西暦）",
                    },
                    target_value: {
                      type: "number",
                      description:
                        "目標値（mieruka_exportの県平均または全国平均。なければ国基本指針等の標準値）",
                    },
                    target_basis: {
                      type: "string",
                      description: "目標根拠（例: 県平均値、全国平均値、国の基本指針）",
                    },
                    affected_population: {
                      type: "number",
                      description: "影響対象人口（概数、不明な場合は省略）",
                    },
                    trend: {
                      type: "string",
                      enum: ["improving", "worsening", "stable", "unknown"],
                      description:
                        "傾向（improving=改善中, worsening=悪化中, stable=横ばい, unknown=不明）",
                    },
                    notes: {
                      type: "string",
                      description: "備考・特記事項",
                    },
                  },
                  required: [
                    "indicator_name",
                    "data_source",
                    "current_value",
                    "current_year",
                    "target_value",
                    "target_basis",
                    "trend",
                  ],
                },
              },
            },
            required: ["gaps"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "create_gap_analyses" },
      messages: [
        {
          role: "user",
          content: `${await getKnowledgeContext(params.id, ["law", "guideline", "plan"])}

以下は日本の市町村の介護保険事業計画策定のためにアップロードされたデータセットです。
各データセットを分析し、主要な指標の現状値を抽出してギャップ分析データを生成してください。

【抽出対象の指標と対応データソース】
- care_insurance_report（介護保険事業状況報告）→ 要介護認定率、受給率の最新値
- needs_survey（ニーズ調査）→ 閉じこもり割合、社会参加率、外出頻度関連指標
- home_care_survey（在宅介護実態調査）→ 要支援1・2の外出付き添い介護不安割合
- dementia_medical_data（認知症関連医療情報）→ 認知症自立度Ⅱ以上の割合
${hasMieruka ? "- mieruka_export（見える化システム）→ 県平均・全国平均を目標値として使用" : "- mieruka_exportなし → 全国標準値・国の基本指針を目標値とする"}

【data_source フィールドの値】介護保険事業 / ニーズ調査 / 認定状況 / サービス利用 / その他　のいずれかを使用
【current_year】データの最新年度（西暦）を設定。不明な場合は調査年度または ${new Date().getFullYear() - 1} を使用

---

${datasetText}`,
        },
      ],
    });

    const toolUse = message.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json(
        { data: null, error: "AI応答の解析に失敗しました" },
        { status: 500 },
      );
    }

    interface GapInput {
      indicator_name: string;
      indicator_unit?: string;
      data_source: string;
      current_value: number;
      current_year: number;
      target_value: number;
      target_basis: string;
      affected_population?: number;
      trend: "improving" | "worsening" | "stable" | "unknown";
      notes?: string;
    }

    const toolInput = toolUse.input as { gaps: GapInput[] };
    const gapsToCreate = Array.isArray(toolInput.gaps) ? toolInput.gaps : [];
    const currentYear = new Date().getFullYear();
    const createdIds: string[] = [];

    for (const g of gapsToCreate) {
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM gap_analyses WHERE project_id = $1 AND indicator_name = $2 LIMIT 1`,
        [params.id, g.indicator_name],
      );

      if (existing) {
        await queryOne(
          `UPDATE gap_analyses
           SET data_source        = $1,
               current_value      = $2,
               current_year       = $3,
               target_value       = $4,
               target_basis       = $5,
               indicator_unit     = $6,
               affected_population = $7,
               trend              = $8,
               notes              = $9,
               updated_at         = now()
           WHERE id = $10`,
          [
            g.data_source,
            g.current_value,
            g.current_year ?? currentYear,
            g.target_value,
            g.target_basis,
            g.indicator_unit ?? null,
            g.affected_population ?? null,
            g.trend,
            g.notes ?? null,
            existing.id,
          ],
        );
        createdIds.push(existing.id);
      } else {
        const row = await queryOne<{ id: string }>(
          `INSERT INTO gap_analyses
             (project_id, indicator_name, indicator_unit, data_source,
              current_value, current_year, target_value, target_basis,
              affected_population, trend, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id`,
          [
            params.id,
            g.indicator_name,
            g.indicator_unit ?? null,
            g.data_source,
            g.current_value,
            g.current_year ?? currentYear,
            g.target_value,
            g.target_basis,
            g.affected_population ?? null,
            g.trend,
            g.notes ?? null,
          ],
        );
        if (row) createdIds.push(row.id);
      }
    }

    return NextResponse.json({ data: { created: createdIds.length, ids: createdIds }, error: null });
  }

  // ── モード2（既存）: gap_ids を指定して AI分析テキストを生成・保存 ──
  const { gap_ids } = parsed.data;

  const placeholders = gap_ids.map((_, i) => `$${i + 2}`).join(", ");
  const gaps = await query(
    `SELECT *,
            gap_value::float,
            current_value::float,
            target_value::float,
            affected_population::float
     FROM gap_analyses
     WHERE project_id = $1 AND id IN (${placeholders})`,
    [params.id, ...gap_ids],
  );

  if (gaps.length === 0) {
    return NextResponse.json({ data: null, error: "対象ギャップが見つかりません" }, { status: 404 });
  }

  const message = await aiCreateMessage(aiCtx, {
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `以下のギャップ分析データを分析し、優先課題と改善提案を日本語で述べてください:\n${JSON.stringify(gaps, null, 2)}`,
      },
    ],
  });

  const analysisText =
    message.content[0]?.type === "text" ? message.content[0].text : "";

  let analyzed = 0;
  for (const gapId of gap_ids) {
    const updated = await queryOne(
      `UPDATE gap_analyses
       SET ai_analysis = $1, updated_at = now()
       WHERE id = $2 AND project_id = $3
       RETURNING id`,
      [analysisText, gapId, params.id],
    );
    if (updated) analyzed++;
  }

  return NextResponse.json({ data: { analyzed }, error: null });
}
