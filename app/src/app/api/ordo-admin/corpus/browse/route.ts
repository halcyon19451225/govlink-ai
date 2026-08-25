export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";

/**
 * 承認済みコーパスの閲覧・検索（📚 コーパス一覧タブ）— X7c §3-3
 *
 * GET ?kind=evidence|measures|context
 *     &q=<全文検索: タイトル・要約・出典の ILIKE> &category=<分野>
 *     &level=<1-5> &band=<規模帯> &sourceKind=<出所>
 *     &hasEffect=1（効果量あり） &hasFiscal=1（財政効果率あり）
 *     &expired=1（context: 期限切れのみ。既定は期限内のみ）
 *     &limit=&offset= &format=csv
 *
 * - 対象は **status='approved' のみ**。閲覧専用（このAPIは書き込みを持たない）
 * - カテゴリーchip用の件数（category以外のフィルタを適用した分布）を同梱
 * - CSV は棚卸し用（全項目ではなく一覧列＋出典）
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ data: null, error: "権限がありません" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const kindParam = p.get("kind");
  const kind = kindParam === "measures" ? "measures" : kindParam === "context" ? "context" : "evidence";
  const table =
    kind === "evidence" ? "corpus_evidence" : kind === "measures" ? "corpus_measures" : "corpus_context";

  const conds: string[] = ["t.status = 'approved'"];
  const params: unknown[] = [];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    conds.push(cond.replaceAll("$N", `$${params.length}`));
  };

  const q = p.get("q")?.trim();
  if (q) {
    if (kind === "evidence") {
      add("(t.title ILIKE '%' || $N || '%' OR t.effect_summary ILIKE '%' || $N || '%' OR t.source ILIKE '%' || $N || '%')", q);
    } else if (kind === "measures") {
      add("(t.title ILIKE '%' || $N || '%' OR COALESCE(t.intervention,'') ILIKE '%' || $N || '%' OR COALESCE(t.source_note,'') ILIKE '%' || $N || '%')", q);
    } else {
      add("(t.title ILIKE '%' || $N || '%' OR t.body ILIKE '%' || $N || '%' OR t.source_org ILIKE '%' || $N || '%')", q);
    }
  }
  const band = p.get("band")?.trim();
  if (band) add("t.population_band = $N", band);
  const sourceKind = p.get("sourceKind")?.trim();
  if (sourceKind && kind !== "context") add("t.source_kind = $N", sourceKind);
  const level = Number(p.get("level"));
  if (kind === "evidence" && Number.isFinite(level) && level >= 1 && level <= 5) {
    add("t.evidence_level = $N", Math.round(level));
  }
  if (kind === "evidence") {
    if (p.get("hasEffect") === "1") conds.push("t.effect_size_value IS NOT NULL");
    if (p.get("hasFiscal") === "1") conds.push("t.fiscal_effect_rate IS NOT NULL");
  }
  if (kind === "context") {
    const ctxKind = p.get("ctxKind")?.trim();
    if (ctxKind) add("t.kind = $N", ctxKind);
    // 期限切れ（effective_until 超過）は既定で除外・expired=1 で期限切れだけを別枠表示
    conds.push(
      p.get("expired") === "1"
        ? "(t.effective_until IS NOT NULL AND t.effective_until < CURRENT_DATE)"
        : "(t.effective_until IS NULL OR t.effective_until >= CURRENT_DATE)",
    );
  }

  // カテゴリー分布は category フィルタ抜きで数える（chipの件数が絞り込みで消えない）
  const chipWhere = conds.join(" AND ");
  const category = p.get("category")?.trim();
  if (category) add("t.field_category = $N", category);
  const where = conds.join(" AND ");

  const rawLimit = Number(p.get("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.round(rawLimit))) : 50;
  const rawOffset = Number(p.get("offset") ?? "0");
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.round(rawOffset)) : 0;

  const listCols =
    kind === "evidence"
      ? `t.id, t.title, t.field_category, t.population_band, t.evidence_level, t.design,
         t.effect_summary, t.source, t.url, t.year, t.source_kind,
         t.effect_size_type, t.effect_size_value, t.ci_low, t.ci_high, t.p_value,
         t.fiscal_effect_rate, t.outcome_tier, t.dup_of,
         t.reviewed_at::text AS reviewed_at`
      : kind === "measures"
        ? `t.id, t.title, t.field_category, t.population_band, t.evidence_status,
           t.intervention, t.effect_note, t.total_budget, t.unit_cost, t.source_kind, t.source_note,
           t.reviewed_at::text AS reviewed_at`
        : `t.id, t.title, t.field_category, t.population_band, t.kind, t.pestle_tag, t.seven_s_tag,
           t.swot_hint, t.region_scope, t.region_code, t.body, t.source_org, t.source_url,
           t.published_at::text AS published_at, t.effective_until::text AS effective_until,
           t.reviewed_at::text AS reviewed_at`;

  try {
    const rows = await query(
      `SELECT ${listCols}
       FROM ${table} t
       WHERE ${where}
       ORDER BY t.reviewed_at DESC NULLS LAST, t.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const totalRow = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table} t WHERE ${where}`,
      params,
    );
    const total = Number(totalRow?.n ?? 0);

    // ── CSV出力（棚卸し用） ──
    if (p.get("format") === "csv") {
      const esc = (v: unknown) => {
        if (v == null) return "";
        const s = String(v).replaceAll('"', '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const header =
        kind === "evidence"
          ? ["id", "タイトル", "分野", "規模帯", "Lv", "デザイン", "効果の要約", "効果量種別", "効果量", "CI下限", "CI上限", "p値", "財政効果率", "出典", "年", "URL", "出所", "承認日"]
          : kind === "measures"
            ? ["id", "タイトル", "分野", "規模帯", "エビデンス状況", "介入", "実績", "事業費", "単価", "出所", "出典", "承認日"]
            : ["id", "タイトル", "種別", "PESTLE", "7S", "SWOT", "地域", "分野", "本文", "出典機関", "URL", "適用期限", "承認日"];
      const toRow = (r: Record<string, unknown>) =>
        kind === "evidence"
          ? [r.id, r.title, r.field_category, r.population_band, r.evidence_level, r.design, r.effect_summary, r.effect_size_type, r.effect_size_value, r.ci_low, r.ci_high, r.p_value, r.fiscal_effect_rate, r.source, r.year, r.url, r.source_kind, r.reviewed_at]
          : kind === "measures"
            ? [r.id, r.title, r.field_category, r.population_band, r.evidence_status, r.intervention, r.effect_note, r.total_budget, r.unit_cost, r.source_kind, r.source_note, r.reviewed_at]
            : [r.id, r.title, r.kind, r.pestle_tag, r.seven_s_tag, r.swot_hint, r.region_scope, r.field_category, r.body, r.source_org, r.source_url, r.effective_until, r.reviewed_at];
      const csv =
        "﻿" + // BOM（Excelでの文字化け防止）
        [header, ...rows.map((r) => toRow(r as Record<string, unknown>))]
          .map((cols) => cols.map(esc).join(","))
          .join("\r\n");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="corpus_${kind}_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // ── カテゴリーchip（category フィルタ抜きの分布） ──
    const chipParams = category ? params.slice(0, -1) : params;
    const chips = await query<{ category: string | null; n: string }>(
      `SELECT t.field_category AS category, count(*)::text AS n
       FROM ${table} t
       WHERE ${chipWhere}
       GROUP BY t.field_category
       ORDER BY count(*) DESC, t.field_category NULLS LAST`,
      chipParams,
    );

    // context の期限切れ件数（別枠表示のバッジ用）
    let expiredCount = 0;
    if (kind === "context") {
      const ex = await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM corpus_context t
         WHERE t.status = 'approved' AND t.effective_until IS NOT NULL AND t.effective_until < CURRENT_DATE`,
      );
      expiredCount = Number(ex?.n ?? 0);
    }

    return NextResponse.json({
      data: {
        kind,
        rows,
        total,
        chips: chips.map((c) => ({ category: c.category, n: Number(c.n) })),
        expired_count: expiredCount,
      },
      error: null,
    });
  } catch (e) {
    console.error("コーパス一覧（閲覧）の取得に失敗:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        data: null,
        error: `コーパス一覧の取得に失敗しました（詳細: ${detail}）。042/043 のマイグレーション実行状況を確認してください`,
      },
      { status: 500 },
    );
  }
}
