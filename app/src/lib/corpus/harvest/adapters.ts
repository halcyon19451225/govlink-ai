/**
 * 収集アダプタの正本（純粋・テスト可能）— X7a
 *
 * corpus_sources.adapter はここに登録されたキーのみ有効
 * （未登録アダプタのソースはエンジンが実行時に拒否する）。
 *
 * X7a はアダプタA（構造化ソース）2本:
 *  - env_best    … 環境省 日本版ナッジ・ユニット（BEST）— 政府標準利用規約系。初弾
 *  - nudge_share … 自治体ナッジシェア — 要事前許諾。実装のみ・許諾完了まで enabled=false
 * X7b で generic_pdf / 海外DB、X7d で学術API、X7e で統計・行政データを追加予定。
 *
 * 設計: claude/coe-x7-pdca-design.md 第1部 §2。
 */

// ─── HTML分解の小道具（純関数） ────────────────────────────

export interface HarvestListItem {
  /** source_key の安定ID素材（URL由来） */
  stableId: string;
  title: string;
  url: string;
}

/** HTMLからタグを落としてテキスト化（比較ハッシュ・本文抽出用の簡易版） */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export interface AnchorInfo {
  href: string;
  text: string;
}

/** aタグの href とテキストを列挙する */
export function extractAnchors(html: string): AnchorInfo[] {
  const out: AnchorInfo[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]?.trim() ?? "";
    const text = htmlToText(m[2] ?? "");
    if (href) out.push({ href, text });
  }
  return out;
}

/** 相対URLを絶対化。失敗時は null */
export function absolutizeUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function sameHost(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).hostname === new URL(baseUrl).hostname;
  } catch {
    return false;
  }
}

function stableIdOf(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .join("-");
    return (tail || u.hostname).slice(-100);
  } catch {
    return url.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);
  }
}

/** 明らかにナビゲーション・定型リンクのテキストを除外する */
const NAV_WORDS = [
  "ホーム",
  "トップ",
  "サイトマップ",
  "お問い合わせ",
  "プライバシー",
  "利用規約",
  "English",
  "検索",
  "ログイン",
  "戻る",
  "次へ",
  "前へ",
  "一覧へ",
  "こちら",
];

function isNavText(text: string): boolean {
  if (text.length < 8) return true;
  return NAV_WORDS.some((w) => text === w || (text.length <= 12 && text.includes(w)));
}

// ─── アダプタ定義 ─────────────────────────────────────────

export interface HarvestAdapterDef {
  key: string;
  label: string;
  /** 出典表記に使う機関名 */
  sourceOrg: string;
  /** 海外ソースか（外的妥当性メモ必須・金額は参考値扱い） */
  overseas: boolean;
  /** 1回のrunで処理する新規アイテムの上限（Amplifyタイムアウト対策。超過分は次回） */
  itemLimitPerRun: number;
  /** 一覧HTMLから候補アイテムを抽出する（純関数） */
  listItems(html: string, baseUrl: string): HarvestListItem[];
  /** 抽出プロンプトへのソース特記（判定規律の追加指示） */
  promptHint: string;
}

/**
 * env_best — 環境省 日本版ナッジ・ユニット（BEST）
 * 一覧ページから事例・報告資料へのリンク（PDF含む）を拾う。
 */
const envBest: HarvestAdapterDef = {
  key: "env_best",
  label: "環境省 BEST（日本版ナッジ・ユニット）",
  sourceOrg: "環境省 日本版ナッジ・ユニット（BEST）",
  overseas: false,
  itemLimitPerRun: 5,
  listItems(html, baseUrl) {
    const seen = new Set<string>();
    const items: HarvestListItem[] = [];
    for (const a of extractAnchors(html)) {
      const url = absolutizeUrl(a.href, baseUrl);
      if (!url || !sameHost(url, baseUrl)) continue;
      const isPdf = /\.pdf(\?|$)/i.test(url);
      const isContent = /\/content\/|nudge/i.test(url);
      if (!isPdf && !isContent) continue;
      if (isNavText(a.text)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ stableId: stableIdOf(url), title: a.text.slice(0, 200), url });
    }
    return items;
  },
  promptHint:
    "環境省 日本版ナッジ・ユニット（BEST）の公開資料です。ナッジ実証（勧奨はがき・省エネレポート等）の" +
    "検証結果を拾ってください。無作為割付（RCT）の明記が無い実証を rct にしないこと（qed か prepost）。",
};

/**
 * nudge_share — 自治体ナッジシェア
 * ★要事前許諾。アダプタは実装のみで、許諾完了まで corpus_sources.enabled=false のまま運用する。
 */
const nudgeShare: HarvestAdapterDef = {
  key: "nudge_share",
  label: "自治体ナッジシェア",
  sourceOrg: "自治体ナッジシェア",
  overseas: false,
  itemLimitPerRun: 5,
  listItems(html, baseUrl) {
    const seen = new Set<string>();
    const items: HarvestListItem[] = [];
    for (const a of extractAnchors(html)) {
      const url = absolutizeUrl(a.href, baseUrl);
      if (!url || !sameHost(url, baseUrl)) continue;
      // 記事・事例詳細らしいパス（深さ2以上）に限定する
      let depth = 0;
      try {
        depth = new URL(url).pathname.split("/").filter(Boolean).length;
      } catch {
        continue;
      }
      if (depth < 2 && !/\.pdf(\?|$)/i.test(url)) continue;
      if (isNavText(a.text)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ stableId: stableIdOf(url), title: a.text.slice(0, 200), url });
    }
    return items;
  },
  promptHint:
    "自治体ナッジシェアの事例ページです。自治体名・実施年度・検証デザイン（RCTか否か）・" +
    "効果量の記載を丁寧に拾ってください。出典には掲載ページ名を含めます。",
};

// ─── レジストリ ───────────────────────────────────────────

export const HARVEST_ADAPTERS: Record<string, HarvestAdapterDef> = {
  [envBest.key]: envBest,
  [nudgeShare.key]: nudgeShare,
};

export function getAdapter(key: string): HarvestAdapterDef | null {
  return HARVEST_ADAPTERS[key] ?? null;
}

export const HARVEST_ADAPTER_KEYS = Object.keys(HARVEST_ADAPTERS);
