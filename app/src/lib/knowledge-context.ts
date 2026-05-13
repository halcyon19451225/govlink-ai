import "server-only";
import { query, queryOne } from "@/lib/db";

interface DictSection {
  id: string;
  title: string;
  category: string;
  summary: string;
  key_points: string[];
  planning_implications: string[];
  terms?: Record<string, string>;
}

const CATEGORY_LABEL: Record<string, string> = {
  law: "法令", guideline: "基本指針・通知", research: "調査研究",
  plan: "計画書", policy: "策定方針", ordinance: "条例", other: "その他",
};

// プロジェクトに紐付いたナレッジコンテキストをAI向け文字列として取得
export async function getKnowledgeContext(
  projectId: string,
  relevantCategories?: string[],
): Promise<string> {
  // プロジェクトの municipality_id を取得
  const project = await queryOne<{ municipality_id: string }>(
    `SELECT municipality_id FROM projects WHERE id = $1`,
    [projectId],
  );
  if (!project) return "";

  const { municipality_id } = project;

  // プロジェクトに紐付いたナレッジリンクを取得
  const links = await query<{ knowledge_dict_id: string; linked_section_ids: string[] }>(
    `SELECT knowledge_dict_id, linked_section_ids FROM project_knowledge_links WHERE project_id = $1`,
    [projectId],
  );

  // Tier1辞書
  const tier1 = await queryOne<{ dict_data: { sections?: DictSection[] } }>(
    `SELECT dict_data FROM knowledge_dicts WHERE tier = 1 AND municipality_id IS NULL`,
  );

  // Tier2辞書（自自治体）
  const tier2 = await queryOne<{ dict_data: { sections?: DictSection[] } }>(
    `SELECT dict_data FROM knowledge_dicts WHERE tier = 2 AND municipality_id = $1`,
    [municipality_id],
  );

  const allSections: DictSection[] = [
    ...((tier1?.dict_data.sections ?? []) as DictSection[]),
    ...((tier2?.dict_data.sections ?? []) as DictSection[]),
  ];

  if (allSections.length === 0) return "";

  // 紐付けられたセクションIDを集める
  const linkedSectionIds = new Set(links.flatMap((l) => l.linked_section_ids ?? []));

  // フィルタリング
  let sections = linkedSectionIds.size > 0
    ? allSections.filter((s) => linkedSectionIds.has(s.id))
    : allSections;

  if (relevantCategories && relevantCategories.length > 0) {
    sections = sections.filter((s) => relevantCategories.includes(s.category));
  }

  if (sections.length === 0) return "";

  // AI向けテキスト整形
  const lines: string[] = ["【参照ナレッジ】"];

  for (const section of sections) {
    const categoryLabel = CATEGORY_LABEL[section.category] ?? section.category;
    lines.push(`\n■ ${section.title}（${categoryLabel}）`);

    if (section.summary) {
      lines.push(`  概要: ${section.summary}`);
    }

    if (section.key_points.length > 0) {
      lines.push(`  要点:`);
      for (const kp of section.key_points) {
        lines.push(`    • ${kp}`);
      }
    }

    if (section.planning_implications.length > 0) {
      lines.push(`  計画策定上の留意点:`);
      for (const pi of section.planning_implications) {
        lines.push(`    → ${pi}`);
      }
    }
  }

  return lines.join("\n");
}
