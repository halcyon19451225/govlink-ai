/**
 * ロジックモデルの要素（L2）
 *
 * ── なぜ構造化するのか ─────────────────────────────────────────
 * これまでロジックモデルの各欄は「文字列の配列」だった。
 * そのため、
 *   - どの成果にどのKPIが対応するのかを書く場所が無く、
 *     評価の時に人が毎回見比べて対応付けていた
 *   - 並べ替えると別物になり、因果の線（edges）を張る相手を指せなかった
 *   - 文章を1文字直しただけで「別の要素」になった
 * 要素に id を与えることで、KPI紐付け（L3）と因果エッジ（L4）の宛先が定まる。
 *
 * ── 形 ────────────────────────────────────────────────────
 *   { id: "…", text: "介護予防教室の参加者が増える", kpi_ids: ["…"] }
 *
 * ── 後方互換 ───────────────────────────────────────────────
 * DBには歴史的に3つの形が混在している。読む側は必ずこのファイルを通す。
 *   (a) ["文字列", "文字列"]                 … 当初からの形
 *   (b) [{ term: "short"|"long", text }]     … AI生成が outcomes 列に入れていた形
 *   (c) [{ id, text, kpi_ids }]              … L2以降の形
 * 035 で (a)(b) → (c) に揃えるが、揃っていないデータが来ても壊れないようにする。
 * （マイグレーション前のデプロイでも、マイグレーション後の古いバックアップでも動く）
 */

export interface LogicElement {
  id: string;
  text: string;
  /** この要素の達成をどのKPIで見るか。L3のKPI割当UIで編集する */
  kpi_ids: string[];
}

/** 因果エッジ。要素idどうしを結ぶ */
export interface LogicEdge {
  from: string;
  to: string;
  note?: string;
}

// ─── 列の定義（表示順・ラベル・色の正本）──────────────────────

export const LOGIC_COLUMNS = [
  { key: "inputs", label: "投入資源", short: "投入", color: "#6366f1" },
  { key: "activities", label: "実施活動", short: "活動", color: "#8b5cf6" },
  { key: "outputs", label: "産出物", short: "産出", color: "#06b6d4" },
  {
    key: "initial_outcomes",
    label: "短期アウトカム（概ね1年）",
    short: "短期",
    color: "#10b981",
  },
  {
    key: "intermediate_outcomes",
    label: "中間アウトカム（2〜5年）",
    short: "中間",
    color: "#0d9488",
  },
  {
    key: "long_outcomes",
    label: "長期アウトカム（計画期間超）",
    short: "長期",
    color: "#f59e0b",
  },
] as const;

export type LogicColumnKey = (typeof LOGIC_COLUMNS)[number]["key"];

export const LOGIC_COLUMN_KEYS: LogicColumnKey[] = LOGIC_COLUMNS.map((c) => c.key);

/**
 * 列とアウトカム階層（CA工程の indicator_type）の対応。
 * ここがずれていると、計画の「長期」が評価では「中間」として扱われる。
 */
export const COLUMN_TO_INDICATOR_TYPE: Partial<Record<LogicColumnKey, string>> = {
  outputs: "output",
  initial_outcomes: "outcome_initial",
  intermediate_outcomes: "outcome_intermediate",
  long_outcomes: "outcome_long",
};

// ─── id ───────────────────────────────────────────────────

/**
 * 新しい要素idを採番する。
 * crypto.randomUUID はブラウザ・Node18+ の双方にあるが、
 * 古い実行環境や非セキュアコンテキストでは無いことがあるため退避経路を持つ。
 */
export function newElementId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `el_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

// ─── 正規化 ────────────────────────────────────────────────

/** オブジェクトから表示用の文字列を取り出す（{term,text} / {id,text} / {label} など） */
function pickText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const key of ["text", "label", "title", "name", "value"]) {
      const cand = o[key];
      if (typeof cand === "string" && cand.trim() !== "") return cand;
    }
  }
  return "";
}

function pickKpiIds(v: unknown): string[] {
  if (typeof v !== "object" || v === null) return [];
  const o = v as Record<string, unknown>;
  const raw = o["kpi_ids"] ?? o["kpiIds"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/**
 * JSONB の中身を LogicElement[] に正規化する。
 *
 * @param value  DBから来た値（string[] / オブジェクト配列 / {items:[]} / null）
 * @param prefix idを持たない旧データに割り当てる仮idの接頭辞。
 *               列キーを渡すこと（例 "inputs"）。同じ入力なら常に同じidになるので、
 *               画面の再描画で線の宛先が動かない。保存すればこのidが正本になる。
 */
export function normalizeElements(value: unknown, prefix = "el"): LogicElement[] {
  const raw: unknown[] = (() => {
    if (value == null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      // JSONB が文字列として来ることがある（driver 設定差）
      const t = value.trim();
      if (t.startsWith("[")) {
        try {
          const p: unknown = JSON.parse(t);
          if (Array.isArray(p)) return p;
        } catch {
          /* 文字列1件として扱う */
        }
      }
      return t ? [t] : [];
    }
    if (typeof value === "object") {
      const o = value as Record<string, unknown>;
      for (const key of ["items", "list", "values", "elements"]) {
        const arr = o[key];
        if (Array.isArray(arr)) return arr;
      }
      return [o];
    }
    return [];
  })();

  const out: LogicElement[] = [];
  const seen = new Set<string>();

  raw.forEach((item, i) => {
    const text = pickText(item).trim();
    if (text === "") return; // 空要素は落とす（旧データに空文字が混ざっている）

    let id =
      typeof item === "object" && item !== null
        ? String((item as Record<string, unknown>)["id"] ?? "").trim()
        : "";
    if (id === "") id = `${prefix}_${i}`;

    // id の重複は線の宛先を壊すので、後勝ちにせず連番で退避させる
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);

    out.push({ id, text, kpi_ids: pickKpiIds(item) });
  });

  return out;
}

/** 表示だけしたい場合の文字列化 */
export function elementTexts(value: unknown, prefix = "el"): string[] {
  return normalizeElements(value, prefix).map((e) => e.text);
}

/** 保存用（JSONB に入れる形）。id が無いものにはここで採番する */
export function serializeElements(elements: LogicElement[]): LogicElement[] {
  return elements
    .filter((e) => e.text.trim() !== "")
    .map((e) => ({
      id: e.id && e.id.trim() !== "" ? e.id : newElementId(),
      text: e.text.trim(),
      kpi_ids: Array.from(new Set(e.kpi_ids ?? [])),
    }));
}

/** 文字列配列 → 要素配列（APIが旧形式のリクエストを受けたとき用） */
export function elementsFromTexts(texts: string[], prefix = "el"): LogicElement[] {
  return texts
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t !== "")
    .map((text, i) => ({ id: `${prefix}_${i}`, text, kpi_ids: [] }));
}

// ─── エッジ ────────────────────────────────────────────────

export function normalizeEdges(value: unknown): LogicEdge[] {
  if (!Array.isArray(value)) return [];
  const out: LogicEdge[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const o = v as Record<string, unknown>;
    const from = typeof o["from"] === "string" ? o["from"] : "";
    const to = typeof o["to"] === "string" ? o["to"] : "";
    if (!from || !to || from === to) continue;
    const note = typeof o["note"] === "string" ? o["note"] : undefined;
    out.push(note !== undefined ? { from, to, note } : { from, to });
  }
  return out;
}

/**
 * edges が空のときに表示する初期提案（隣接列の総当たり）。
 * これは「まだ因果を書いていない」状態の仮表示であって、保存された因果ではない。
 * 区別できるよう、呼び出し側で破線などにすること。
 */
export function suggestAdjacentEdges(
  columns: Record<LogicColumnKey, LogicElement[]>,
): LogicEdge[] {
  const edges: LogicEdge[] = [];
  let prev: LogicElement[] = [];
  for (const key of LOGIC_COLUMN_KEYS) {
    const curr = columns[key] ?? [];
    if (prev.length > 0 && curr.length > 0) {
      for (const a of prev) for (const b of curr) edges.push({ from: a.id, to: b.id });
    }
    if (curr.length > 0) prev = curr;
  }
  return edges;
}

// ─── モデル全体 ─────────────────────────────────────────────

export type LogicColumns = Record<LogicColumnKey, LogicElement[]>;

/** DBの行（JSONB混在）から、6列すべてを正規化して取り出す */
export function normalizeColumns(row: Record<string, unknown> | null | undefined): LogicColumns {
  const empty = () => [] as LogicElement[];
  const cols = {
    inputs: empty(),
    activities: empty(),
    outputs: empty(),
    initial_outcomes: empty(),
    intermediate_outcomes: empty(),
    long_outcomes: empty(),
  } as LogicColumns;
  if (!row) return cols;

  for (const key of LOGIC_COLUMN_KEYS) {
    cols[key] = normalizeElements(row[key], key);
  }

  // 三層アウトカムが空で、旧 outcomes 列にだけ入っている場合の救済。
  // {term} が無ければ中間として扱う（旧UIが中間の欄に表示していたため）。
  const legacy = row["outcomes"];
  if (legacy != null) {
    const byTerm = (terms: string[], prefix: string): LogicElement[] => {
      if (!Array.isArray(legacy)) return [];
      const picked = legacy.filter((v) => {
        if (typeof v !== "object" || v === null) return false;
        const t = (v as Record<string, unknown>)["term"];
        return typeof t === "string" && terms.includes(t);
      });
      return normalizeElements(picked, prefix);
    };

    if (cols.initial_outcomes.length === 0) {
      cols.initial_outcomes = byTerm(["initial", "short", "outcome_initial"], "initial_outcomes");
    }
    if (cols.long_outcomes.length === 0) {
      cols.long_outcomes = byTerm(["long", "outcome_long"], "long_outcomes");
    }
    if (cols.intermediate_outcomes.length === 0) {
      const mid = byTerm(
        ["intermediate", "mid", "outcome_intermediate"],
        "intermediate_outcomes",
      );
      if (mid.length > 0) {
        cols.intermediate_outcomes = mid;
      } else if (
        cols.initial_outcomes.length === 0 &&
        cols.long_outcomes.length === 0
      ) {
        // term が一切無い旧データ。層が判らないので中間に置く（従来の表示と同じ）
        cols.intermediate_outcomes = normalizeElements(legacy, "intermediate_outcomes");
      }
    }
  }

  return cols;
}

/** モデル内で参照されている全KPI id */
export function collectKpiIds(cols: LogicColumns): string[] {
  const s = new Set<string>();
  for (const key of LOGIC_COLUMN_KEYS) {
    for (const el of cols[key] ?? []) for (const k of el.kpi_ids) s.add(k);
  }
  return Array.from(s);
}

/** 要素id → その要素がどの列にあるか */
export function buildColumnIndex(cols: LogicColumns): Map<string, LogicColumnKey> {
  const m = new Map<string, LogicColumnKey>();
  for (const key of LOGIC_COLUMN_KEYS) {
    for (const el of cols[key] ?? []) m.set(el.id, key);
  }
  return m;
}
