/**
 * マニュアルの frontmatter（M1）— YAMLサブセットのパーサ（純粋・テスト可能）
 *
 * 対応するのは設計 第2.5部の索引形式のみ:
 *   key: value            … 文字列
 *   key: [a, b, c]        … 文字列配列（インライン）
 * それ以外のYAML機能（ネスト・複数行・アンカー等）は扱わない — 依存を増やさない。
 */

export interface ManualMeta {
  module: string;
  title: string;
  menu_path: string;
  tables: string[];
  apis: string[];
  ai_tasks: string[];
  checks: string[];
  migrations: string[];
  upstream: string[];
  downstream: string[];
  updated: string;
}

const LIST_KEYS = ["tables", "apis", "ai_tasks", "checks", "migrations", "upstream", "downstream"] as const;

function parseInlineList(v: string): string[] {
  const inner = v.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** frontmatter（---で囲まれた先頭ブロック）と本文に分ける。frontmatterが無ければ meta=null */
export function parseManual(src: string): { meta: ManualMeta | null; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: null, body: src };
  const body = src.slice(m[0].length);
  const raw: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) raw[kv[1]!] = kv[2]!.trim();
  }
  const list = (k: string): string[] => (raw[k] ? parseInlineList(raw[k]!) : []);
  const meta: ManualMeta = {
    module: raw["module"] ?? "",
    title: raw["title"] ?? "",
    menu_path: raw["menu_path"] ?? "",
    tables: list("tables"),
    apis: list("apis"),
    ai_tasks: list("ai_tasks"),
    checks: list("checks"),
    migrations: list("migrations"),
    upstream: list("upstream"),
    downstream: list("downstream"),
    updated: raw["updated"] ?? "",
  };
  return { meta, body };
}

export { LIST_KEYS };
