export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

const ORDO_ADMIN_EMAIL = "ordoservice.com@gmail.com";
const MODEL = "claude-sonnet-4-6";

interface DictSection {
  section_id?: string;
  id?: string;
  section_title?: string;
  title?: string;
  summary?: string;
  key_points?: string[];
  planning_implications?: string[];
  pdca_tags?: string[];
  terms?: Record<string, string>;
  [key: string]: unknown;
}

interface DictData {
  version?: number;
  sections?: DictSection[];
  global_terms?: Record<string, string>;
  planning_checklist?: string[];
}

interface AiEditBody {
  categoryId: string;
  sectionId: string;
  instruction: string;
}

interface ClaudeEditResult {
  section_title?: string;
  summary?: string;
  key_points?: string[];
  planning_implications?: string[];
  pdca_tags?: string[];
  terms?: Record<string, string>;
  change_note?: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.email !== ORDO_ADMIN_EMAIL) {
    return NextResponse.json({ ok: false, error: "権限がありません" }, { status: 403 });
  }

  const body = await req.json() as AiEditBody;
  const { categoryId, sectionId, instruction } = body;

  if (!categoryId || !sectionId || !instruction?.trim()) {
    return NextResponse.json({ ok: false, error: "categoryId・sectionId・instructionは必須です" }, { status: 400 });
  }

  // 辞書取得
  const rows = await query<{ id: string; dict_data: DictData; version: number }>(
    `SELECT id, dict_data, version FROM knowledge_dicts WHERE tier = 1 AND category_id = $1`,
    [categoryId],
  );
  const dictRow = rows[0];
  if (!dictRow) {
    return NextResponse.json({ ok: false, error: "辞書が見つかりません" }, { status: 404 });
  }

  const dictData = dictRow.dict_data;
  const sections = dictData.sections ?? [];
  const sectionIdx = sections.findIndex(
    (s) => (s.section_id ?? s.id) === sectionId,
  );
  if (sectionIdx === -1) {
    return NextResponse.json({ ok: false, error: "セクションが見つかりません" }, { status: 404 });
  }

  const section = sections[sectionIdx]!;

  const prompt = `あなたは行政計画策定の専門家です。
以下のナレッジセクションを、指示に従って修正してください。
構造（キー）は変えず、内容のみ更新します。

【現在のセクション】
${JSON.stringify(section, null, 2)}

【修正指示】
${instruction}

以下のJSON形式のみで回答（前置きやバッククォート不要）:
{
  "section_title": "...",
  "summary": "...",
  "key_points": ["..."],
  "planning_implications": ["..."],
  "pdca_tags": ["..."],
  "terms": {"用語":"定義"},
  "change_note": "どこをどう変えたかの短い説明"
}`;

  const client = new Anthropic();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = message.content[0]?.type === "text" ? message.content[0].text : "";
  let parsed: ClaudeEditResult = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]) as ClaudeEditResult;
  } catch {
    return NextResponse.json({ ok: false, error: "AIの返答をパースできませんでした" }, { status: 500 });
  }

  const { change_note, ...updatedFields } = parsed;
  const updatedSection: DictSection = {
    ...section,
    ...updatedFields,
    last_updated: new Date().toISOString(),
  };

  sections[sectionIdx] = updatedSection;
  const newVersion = (dictRow.version ?? dictData.version ?? 0) + 1;
  const newDictData: DictData = { ...dictData, sections, version: newVersion };

  await query(
    `UPDATE knowledge_dicts SET dict_data = $1::jsonb, version = $2, updated_at = NOW() WHERE id = $3`,
    [JSON.stringify(newDictData), newVersion, dictRow.id],
  );

  return NextResponse.json({
    ok: true,
    updatedSection,
    change_note: change_note ?? "",
    version: newVersion,
  });
}
