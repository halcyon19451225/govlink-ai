export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

interface Feature { id: string; name: string; url: string; description: string }
interface Project { id: string; title: string; url: string }

const STATIC_FEATURES: Feature[] = [
  { id: "datasets",          name: "データセット管理",   url: "/dashboard", description: "CSV・外部データのインポート・管理" },
  { id: "gap-analysis",      name: "ギャップ分析",       url: "/dashboard", description: "目標値と現状のギャップを可視化" },
  { id: "issue-hypothesis",  name: "課題仮説",           url: "/dashboard", description: "政策課題の仮説立案・管理" },
  { id: "logic-model",       name: "ロジックモデル",     url: "/dashboard", description: "AIによるロジックモデル自動生成" },
  { id: "kpi-report",        name: "KPI報告",            url: "/dashboard", description: "KPI達成状況の定期報告" },
  { id: "kpi-summary",       name: "KPIサマリー",        url: "/dashboard", description: "KPI一覧のサマリービュー" },
  { id: "ebpm",              name: "EBPMスコア",         url: "/dashboard", description: "証拠に基づく政策立案スコア" },
  { id: "evidences",         name: "証拠管理",           url: "/dashboard", description: "政策根拠となるエビデンス管理" },
  { id: "program-evaluation",name: "プログラム評価",     url: "/dashboard", description: "政策プログラムの総合評価" },
  { id: "self-evaluation",   name: "自己評価シート",     url: "/dashboard", description: "自己評価フォームの入力・管理" },
  { id: "cost-efficiency",   name: "コスト効率分析",     url: "/dashboard", description: "費用対効果の分析・可視化" },
  { id: "service-volume",    name: "サービス量分析",     url: "/dashboard", description: "サービス提供量の推移分析" },
  { id: "pdca",              name: "PDCAスケジュール",   url: "/dashboard", description: "PDCAサイクルのスケジュール管理" },
  { id: "documents",         name: "ドキュメント管理",   url: "/dashboard", description: "政策関連文書のアップロード・管理" },
  { id: "lineage",           name: "データ連鎖",         url: "/dashboard", description: "データアーティファクトの連鎖ビュー" },
  { id: "templates",         name: "テンプレート管理",   url: "/templates", description: "政策テンプレートの作成・管理" },
  { id: "users",             name: "ユーザー管理",       url: "/settings/users", description: "ユーザーと権限ロールの管理" },
  { id: "billing",           name: "プラン・請求",       url: "/billing",   description: "サブスクリプションと請求管理" },
  { id: "resources",         name: "組織リソース",       url: "/resources", description: "諮問機関・会議体・ツール管理" },
];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.municipalityId) {
    return NextResponse.json({ data: null, error: "認証が必要です" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const type = req.nextUrl.searchParams.get("type") ?? "all";

  if (!q) return NextResponse.json({ data: { features: [], projects: [] }, error: null });

  const lower = q.toLowerCase();

  const features: Feature[] =
    type !== "policy"
      ? STATIC_FEATURES.filter((f) =>
          f.name.toLowerCase().includes(lower) ||
          f.description.toLowerCase().includes(lower),
        ).slice(0, 6)
      : [];

  let projects: Project[] = [];
  if (type !== "feature") {
    try {
      const rows = await query<{ id: string; title: string }>(
        `SELECT id, title FROM projects
         WHERE municipality_id = $1
           AND title ILIKE $2
         ORDER BY created_at DESC
         LIMIT 8`,
        [session.user.municipalityId, `%${q}%`],
      );
      projects = rows.map((r) => ({ id: r.id, title: r.title, url: `/projects/${r.id}` }));
    } catch {
      projects = [];
    }
  }

  return NextResponse.json({ data: { features, projects }, error: null });
}
