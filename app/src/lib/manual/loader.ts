import "server-only";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isValidTopicId } from "@/lib/manual/topics";
import { parseManual, type ManualMeta } from "@/lib/manual/frontmatter";

/**
 * マニュアルの読み込み（M1）— 正本は app/src/content/manual/<id>.md
 * ID はトピック一覧（topics.ts）で検証してからパスに使う（トラバーサル防止）。
 */

const MANUAL_DIR = join(process.cwd(), "src", "content", "manual");

export interface LoadedManual {
  id: string;
  meta: ManualMeta | null;
  body: string;
}

export async function loadManual(id: string): Promise<LoadedManual | null> {
  if (!isValidTopicId(id)) return null;
  const path = join(MANUAL_DIR, `${id}.md`);
  if (!existsSync(path)) return null;
  const src = await readFile(path, "utf8");
  const { meta, body } = parseManual(src);
  return { id, meta, body };
}

export function manualExists(id: string): boolean {
  if (!isValidTopicId(id)) return false;
  return existsSync(join(MANUAL_DIR, `${id}.md`));
}
