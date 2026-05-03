import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const ESTAT_LIST_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList";
const ESTAT_DATA_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData";

const querySchema = z.object({
  keyword: z.string().min(1, "キーワードは必須です"),
  area: z.string().optional(),
  kpiId: z.string().uuid("kpi_id が不正です").optional(),
});

interface TableInf {
  "@id": string;
  STATISTICS_NAME?: string;
  [key: string]: unknown;
}

interface EStatValue {
  $: string;
  "@unit"?: string;
  "@time"?: string;
  "@area"?: string;
}

function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v !== null && v !== undefined) return [v as T];
  return [];
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const apiKey = process.env.ESTAT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ data: null, error: "ESTAT_API_KEY が設定されていません" }, { status: 500 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { data: null, error: parsed.error.issues[0]?.message ?? "パラメータが不正です" },
      { status: 400 },
    );
  }

  const { keyword, area, kpiId } = parsed.data;

  // Step 1: getStatsList でキーワードに一致する統計表を検索
  let statsDataId: string;
  let tableTitle: string;
  try {
    const listUrl = new URL(ESTAT_LIST_BASE);
    listUrl.searchParams.set("appId", apiKey);
    listUrl.searchParams.set("searchWord", keyword);
    listUrl.searchParams.set("limit", "5");

    const listRes = await fetch(listUrl.toString(), { next: { revalidate: 3600 } });
    if (!listRes.ok) throw new Error(`e-Stat getStatsList エラー: ${listRes.status}`);
    const listJson = await listRes.json() as Record<string, unknown>;

    const statsListObj = (listJson["GET_STATS_LIST"] ?? {}) as Record<string, unknown>;
    const dataListInf = (statsListObj["DATALIST_INF"] ?? {}) as Record<string, unknown>;
    const tables = toArray<TableInf>(dataListInf["TABLE_INF"]);

    const firstTable = tables[0];
    if (!firstTable) {
      return NextResponse.json({ data: [], error: null });
    }

    statsDataId = firstTable["@id"];
    tableTitle = firstTable["STATISTICS_NAME"] ?? keyword;
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "e-Stat API の呼び出しに失敗しました" },
      { status: 502 },
    );
  }

  // Step 2: getStatsData でデータ取得
  // 5桁市区町村コード → 都道府県コード（頭2桁 + "000"）→ 全国 の順でフォールバック
  const areaCodes: string[] = [];
  if (area) {
    areaCodes.push(area);
    if (area.length === 5) areaCodes.push(area.slice(0, 2) + "000");
    else if (area.length === 2) areaCodes.push(area + "000");
  }
  areaCodes.push(""); // 全国フォールバック

  let finalValues: EStatValue[] = [];
  let usedArea = "";
  try {
    for (const areaCode of areaCodes) {
      const dataUrl = new URL(ESTAT_DATA_BASE);
      dataUrl.searchParams.set("appId", apiKey);
      dataUrl.searchParams.set("statsDataId", statsDataId);
      if (areaCode) dataUrl.searchParams.set("cdArea", areaCode);
      dataUrl.searchParams.set("limit", "20");

      const dataRes = await fetch(dataUrl.toString(), { next: { revalidate: 3600 } });
      if (!dataRes.ok) continue;
      const dataJson = await dataRes.json() as Record<string, unknown>;

      const gsd = (dataJson["GET_STATS_DATA"] ?? {}) as Record<string, unknown>;
      const sd = (gsd["STATISTICAL_DATA"] ?? {}) as Record<string, unknown>;
      const di = (sd["DATA_INF"] ?? {}) as Record<string, unknown>;
      const values = toArray<EStatValue>(di["VALUE"]);

      if (values.length > 0) {
        finalValues = values;
        usedArea = areaCode;
        break;
      }
    }
  } catch (err) {
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "e-Stat データ取得に失敗しました" },
      { status: 502 },
    );
  }

  const items = finalValues.slice(0, 20).map((v) => ({
    label: tableTitle,
    value: parseFloat(v.$) || 0,
    unit: v["@unit"] ?? "",
    year: v["@time"] ? parseInt(v["@time"].slice(0, 4)) : null,
    area: v["@area"] ?? usedArea,
    source: "estat",
  }));

  // kpiId が指定されていれば benchmark_values に保存
  if (kpiId && items.length > 0) {
    for (const item of items.slice(0, 5)) {
      await query(
        `INSERT INTO benchmark_values (kpi_id, source, label, value, unit, year, notes)
         VALUES ($1, 'estat', $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [kpiId, item.label, item.value, item.unit, item.year, `エリア: ${item.area}`],
      );
    }
  }

  return NextResponse.json({ data: items, error: null });
}
