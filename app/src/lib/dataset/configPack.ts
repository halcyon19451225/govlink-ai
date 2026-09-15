/**
 * 設定パック — 庁内の変換ツールに渡す「この計画の決めごと」一式
 * 設計: claude/coe-dataset-model.md §6-4・§8
 *
 * 変換ツール（Flow）は庁内で動き、Coe には繋がらない。それでも
 * **辞書・キー種別・粗化のはしご・k/ℓ は Coe の正本と同じでなければならない**。
 * 二重に書けば必ず乖離するので、正本はここ（Coe の DB）だけに置き、
 * 変換ツールへは書き出したファイルを人が持っていく。
 *
 * ★ この層は分野に依存しない。辞書の中身（コア／分野パック／テナント拡張）は
 *   呼び出し側が解決して渡す。ここは**形を決めるだけ**。
 *
 * 鍵は入らない。鍵 ID も入らない（鍵は庁内にしかなく、パックは Coe が作るため）。
 * 個人を特定しうる値も入らない（入る余地の無い型にしてある）。
 *
 * パックには digest を入れる。取り込んだ個票の meta.json が
 * どの版の決めごとで作られたかを、あとから突き合わせられるようにするため。
 */
import { createHash } from "node:crypto";
import type { AttributeDefinition, KeyTypeDefinition } from "./types";
import { DICTIONARY_VERSION } from "./dictionary";

/** パックの形式そのものの版。形を変えたら上げる（変換ツールが古い形を見分けられるように） */
export const CONFIG_PACK_VERSION = 1;

/** k-匿名性の既定。庁内ツールと Coe の再検定で同じ値を使う */
export const DEFAULT_ANONYMITY = { k: 10, l: 2 } as const;

export interface ConfigPackInput {
  project: { id: string; name: string; planType: string | null };
  municipality: { id: string; name: string; prefecture: string };
  datasets: ReadonlyArray<{
    id: string;
    name: string;
    kind: string;
    /** individual なら { attr_keys }、aggregate なら列定義。箱が受け取れる形 */
    schema: unknown;
  }>;
  keyTypes: readonly KeyTypeDefinition[];
  attributes: readonly AttributeDefinition[];
  /** 分野パックの表示名（無ければ null） */
  domain: { planType: string; label: string } | null;
  generatedAt: string;
}

export interface ConfigPack {
  pack_version: number;
  generated_at: string;
  municipality: { id: string; name: string; prefecture: string };
  project: { id: string; name: string; plan_type: string | null };
  domain: { plan_type: string; label: string } | null;
  datasets: Array<{
    id: string;
    name: string;
    /** aggregate / individual */
    kind: string;
    /** 個票の箱は attr_keys（受け取れる属性キー）、集計の箱は columns（列定義） */
    attr_keys?: string[];
    columns?: unknown[];
  }>;
  key_types: Array<{
    code: string;
    label: string;
    description: string;
    normalization: { style: string; zero_pad?: number; min_length?: number; max_length?: number };
    is_primary: boolean;
  }>;
  dictionary: {
    version: number;
    attrs: Array<{
      key: string;
      label: string;
      description: string;
      /** code / band / int / numeric / bool / month / fiscal_year。**自由記述は無い** */
      type: string;
      codes?: Record<string, string>;
      unit?: string;
      /** quasi_identifier / sensitive / exposure / outcome / neutral */
      role: string;
      /** false なら、対応づけても出力してはならない */
      cloud_allowed: boolean;
      /** day / month / fiscal_year / static */
      granularity: string;
      /** true なら値の語彙が自治体ごと。codes が空なら、その自治体ではまだ使えない */
      local_codes: boolean;
      origin: string;
      source_hints: string[];
      /**
       * 粗化のはしご。**規則ではなく値の対応表**で持つ。
       * 値の語彙が自治体ごとに違う属性があるので、「頭2文字」のような規則では
       * 自治体によって意味が変わってしまう。level 0 は codes そのもの
       */
      coarsen?: {
        priority: number;
        levels: Array<{ label: string; map?: Record<string, string>; collapse_to?: string }>;
      };
    }>;
  };
  /** 業務システムの列名 → 属性キー の初期値。人が画面で直せる前提の当て推量 */
  mapping_seed: Record<string, string>;
  anonymity: { k: number; l: number };
  /** このパックの内容の指紋（digest を除いた本体の SHA-256） */
  digest: string;
}

/** キーの順序に依存しない JSON 文字列化（digest を安定させるため） */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys
    .map((k) => JSON.stringify(k) + ":" + stable((value as Record<string, unknown>)[k]))
    .join(",") + "}";
}

/**
 * 設定パックを組み立てる。純関数（DB も時計も触らない）。
 * generatedAt は呼び出し側が渡す — 同じ入力から同じ digest が出るようにするため
 * （digest には generated_at を含めない）。
 */
export function buildConfigPack(input: ConfigPackInput): ConfigPack {
  const attrs = [...input.attributes]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((d) => ({
      key: d.key,
      label: d.label,
      description: d.description,
      type: d.valueType,
      ...(d.codes ? { codes: d.codes } : {}),
      ...(d.unit ? { unit: d.unit } : {}),
      role: d.role,
      cloud_allowed: d.cloudAllowed,
      granularity: d.timeGranularity,
      local_codes: d.localCodes === true,
      origin: d.origin ?? "core",
      source_hints: [...(d.sourceHints ?? [])],
      ...(d.generalization
        ? {
            coarsen: {
              priority: d.generalization.priority,
              levels: d.generalization.levels.map((lv) => ({
                label: lv.label,
                ...(lv.map ? { map: lv.map } : {}),
                ...(lv.collapseTo ? { collapse_to: lv.collapseTo } : {}),
              })),
            },
          }
        : {}),
    }));

  // 対応づけの初期値。同じ列名を複数の属性が名乗ったら**先に来た方を採らない** —
  // どちらが正しいか機械には決められないので、その列は出さずに人に選ばせる
  const claims = new Map<string, string[]>();
  for (const d of input.attributes) {
    if (!d.cloudAllowed) continue;
    for (const hint of d.sourceHints ?? []) {
      const list = claims.get(hint);
      if (list) list.push(d.key);
      else claims.set(hint, [d.key]);
    }
  }
  const mapping_seed: Record<string, string> = {};
  for (const hint of Array.from(claims.keys()).sort()) {
    const list = claims.get(hint)!;
    if (list.length === 1) mapping_seed[hint] = list[0]!;
  }

  const body = {
    pack_version: CONFIG_PACK_VERSION,
    municipality: input.municipality,
    project: { id: input.project.id, name: input.project.name, plan_type: input.project.planType },
    domain: input.domain ? { plan_type: input.domain.planType, label: input.domain.label } : null,
    datasets: input.datasets.map((d) => {
      const schema = d.schema as { attr_keys?: unknown; } | unknown[] | null;
      const attrKeys = schema && !Array.isArray(schema) && Array.isArray(schema.attr_keys)
        ? (schema.attr_keys as string[])
        : null;
      return {
        id: d.id,
        name: d.name,
        kind: d.kind,
        // 箱が何を受け取れるかを渡す。渡さないと変換ツールが辞書の全属性を並べてしまい、
        // その箱に入らない属性まで対応づけられてしまう
        ...(attrKeys ? { attr_keys: [...attrKeys].sort() } : {}),
        ...(Array.isArray(schema) ? { columns: schema } : {}),
      };
    }),
    key_types: [...input.keyTypes]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((t) => ({
        code: t.code,
        label: t.label,
        description: t.description,
        normalization: {
          style: t.normalization.style,
          ...(t.normalization.zeroPad !== undefined ? { zero_pad: t.normalization.zeroPad } : {}),
          ...(t.normalization.minLength !== undefined ? { min_length: t.normalization.minLength } : {}),
          ...(t.normalization.maxLength !== undefined ? { max_length: t.normalization.maxLength } : {}),
        },
        is_primary: t.isPrimary === true,
      })),
    dictionary: { version: DICTIONARY_VERSION, attrs },
    mapping_seed,
    anonymity: { k: DEFAULT_ANONYMITY.k, l: DEFAULT_ANONYMITY.l },
  };

  return {
    ...body,
    generated_at: input.generatedAt,
    digest: createHash("sha256").update(stable(body)).digest("hex"),
  };
}

/**
 * 取込口が使う照合。個票の meta.json が、いま Coe が正本としている辞書と
 * 同じ版で作られているかを見る。
 *
 * **古い版を黙って受け入れてはならない** — 粗化のはしごが変わっていれば、
 * 同じセルが k を満たしているかどうかが変わる。通してしまうと、
 * 「検定を通った」という記録だけが残って、実際には通っていないことになる。
 */
export type PackMismatch =
  | { ok: true }
  | { ok: false; reason: "missing"; detail: string }
  | { ok: false; reason: "older_dictionary"; detail: string }
  | { ok: false; reason: "newer_dictionary"; detail: string }
  | { ok: false; reason: "unknown_pack_version"; detail: string };

export function checkPackCompatibility(meta: {
  dictionary_version?: unknown;
  pack_version?: unknown;
}): PackMismatch {
  const dv = meta.dictionary_version;
  if (typeof dv !== "number" || !Number.isInteger(dv)) {
    return { ok: false, reason: "missing", detail: "meta.json に dictionary_version がありません" };
  }
  const pv = meta.pack_version;
  if (pv !== undefined && (typeof pv !== "number" || pv > CONFIG_PACK_VERSION)) {
    return {
      ok: false,
      reason: "unknown_pack_version",
      detail: `設定パックの形式が新しすぎます（ファイル ${String(pv)} / Coe ${CONFIG_PACK_VERSION}）`,
    };
  }
  if (dv < DICTIONARY_VERSION) {
    return {
      ok: false,
      reason: "older_dictionary",
      detail: `古い辞書で作られています（ファイル 第${dv}版 / Coe 第${DICTIONARY_VERSION}版）。設定パックを取り直して変換し直してください`,
    };
  }
  if (dv > DICTIONARY_VERSION) {
    return {
      ok: false,
      reason: "newer_dictionary",
      detail: `Coe より新しい辞書で作られています（ファイル 第${dv}版 / Coe 第${DICTIONARY_VERSION}版）`,
    };
  }
  return { ok: true };
}
