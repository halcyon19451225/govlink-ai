/**
 * 収集アダプタの正本（純粋・テスト可能）— X7a / X7b
 *
 * corpus_sources.adapter はここに登録されたキーのみ有効
 * （未登録アダプタのソースはエンジンが実行時に拒否する）。
 *
 * mode の2系統:
 *  - extract          … アダプタA: 本文→AI構造化抽出→corpus_evidence(pending)
 *  - pdf_to_knowledge … アダプタB: PDF→S3原本保全→Tier1ナレッジ自動登録→既存X3フロー合流
 *                       （AI抽出は既存のナレッジ抽出タブから。無確認でコーパスに入らない）
 *
 * 登録済み:
 *  - env_best        … 環境省BEST（A・政府標準利用規約系）— X7a初弾
 *  - nudge_share     … 自治体ナッジシェア（A・要事前許諾。許諾完了まで enabled=false）— X7a
 *  - jages_press     … JAGESプレスリリース（A・NetCommons形式のPDFダウンロード）— X7b
 *  - mhlw_grants     … 厚労科研成果DB（B・/project/{id}→報告書PDF）— X7b
 *  - wsipp           … WSIPP Benefit-Cost（A・海外: 外的妥当性メモ必須）— X7b
 *  - community_guide … The Community Guide（A・海外）— X7b
 * X7d で学術API、X7e で統計・行政データを追加予定。
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

/**
 * href属性内のHTMLエンティティを実文字へ戻す。
 * 実HTMLではクエリの「&」が「&amp;」でエスケープされるため、これを戻さないと
 * `[?&]content_id=` 等のパラメータ照合が全て失敗する（JAGES候補0件の実バグ・2026-08-25）。
 */
export function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** aタグの href とテキストを列挙する */
export function extractAnchors(html: string): AnchorInfo[] {
  const out: AnchorInfo[] = [];
  const re = /<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = decodeHtmlAttr(m[1]?.trim() ?? "");
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
  /**
   * パーサの版数（省略時1）。エンジンの差分ハッシュに混ぜられるため、
   * **アダプタの抽出ロジックを修正したら必ず上げる** — ページ内容が同じでも
   * 「変化なし」の早期終了をせず再処理される（修正が反映されない事故の防止）。
   */
  parserVersion?: number;
  /**
   * 処理系統。省略時は 'extract'（アダプタA）。
   * 'pdf_to_knowledge'（アダプタB）は item のページ/PDFを S3 に原本保全し
   * Tier1ナレッジへ自動登録する（コーパスへの直接投入はしない）。
   * 'transcribe'（アダプタD）は**AIの生成を挟まない機械転記** —
   * API/CSVの数値・名称・出典をそのまま構造化し、要約文はテンプレート生成する
   * （推測混入リスクが構造的にゼロ → light 検収に適合。§3-4）。
   */
  mode?: "extract" | "pdf_to_knowledge" | "transcribe";
  /**
   * transcribe 用: 取得した応答本文（JSON/CSV）から corpus_context 行・
   * corpus_measures 参照行を機械転記する（純関数）。
   */
  transcribe?(body: string, queryConfig: Record<string, unknown> | null): TranscribeResult;
  /**
   * 取得URLの前処理（APIキーの付与など）。env 未設定などで実行できない場合は
   * error を返す（エンジンが run を failed にして明示する）。
   */
  prepareUrl?(baseUrl: string, env: Record<string, string | undefined>): { url: string } | { error: string };
  /** 1回のrunで処理する新規アイテムの上限（Amplifyタイムアウト対策。超過分は次回） */
  itemLimitPerRun: number;
  /** 一覧HTMLから候補アイテムを抽出する（純関数） */
  listItems(html: string, baseUrl: string): HarvestListItem[];
  /**
   * pdf_to_knowledge 用: アイテムページのHTMLから報告書PDFのURLを解決する（純関数）。
   * item.url 自体がPDFの場合は不要。
   */
  resolvePdfUrls?(html: string, pageUrl: string): string[];
  /**
   * アダプタC（学術ソース）用の判定規律（X7d）:
   * - screening: 構造化抽出の前に軽量スクリーニングで足切りする
   *   （「日本の自治体施策に翻訳可能な介入研究か / 検証デザインの明記があるか」— ここで大半を捨てる）
   * - conservativeLevel: 抄録・記事ページだけで rct を名乗る行は本文確認まで Lv を1段保守的に
   * - fullTextChase: 効果量が取れなかったとき、OA本文（PMC / J-STAGE全文）を1回だけ追撃取得
   */
  screening?: boolean;
  conservativeLevel?: boolean;
  fullTextChase?: boolean;
  /** 抽出プロンプトへのソース特記（判定規律の追加指示） */
  promptHint: string;
}

/**
 * 記事ページのHTMLからOA本文へのリンクを探す（追撃取得用・純関数）。
 * PMC（PubMed Central）と J-STAGE の全文ページ（…/_article/…）を対象にする。
 */
export function findFullTextUrl(html: string, baseUrl: string): string | null {
  for (const a of extractAnchors(html)) {
    const url = absolutizeUrl(a.href, baseUrl);
    if (!url) continue;
    if (/ncbi\.nlm\.nih\.gov\/pmc\/articles\/PMC\d+|pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+/i.test(url)) {
      return url;
    }
    if (/jstage\.jst\.go\.jp\/article\/.+\/_article/i.test(url)) return url;
  }
  return null;
}

/** XMLからタグ内テキストを取り出す簡易ヘルパー（アダプタCのAPI応答パース用） */
function xmlText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? htmlToText(m[1] ?? "").trim() || null : null;
}

function xmlBlocks(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi")) ?? [];
}

/** HTMLからPDFへのリンクを列挙する（pdf_to_knowledge の既定ヘルパー） */
export function extractPdfLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of extractAnchors(html)) {
    const url = absolutizeUrl(a.href, baseUrl);
    if (!url || !/\.pdf(\?|$)/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
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

/**
 * jages_press — JAGES（日本老年学的評価研究）研究成果・プレスリリース — X7b/X7e改
 *
 * 収集面はNetCommonsの**多目的DB（更新履歴）一覧ページ**（サーバー描画・記事リンクあり）。
 * ⚠ /library/pressrelease/ の年度フォルダはJavaScript駆動でHTMLにリンクが出ないため
 *   一覧面として使えない（2026-08-25 実地確認 — 過去分バックログはwebseedで補う）。
 * 拾う対象:
 *  - 記事詳細: index.php?active_action=multidatabase_view_main_detail&content_id=NNNN…
 *    （研究成果の発表記事。開催案内等の非研究記事はAI抽出が空配列を返すだけ）
 *  - ファイル直リンク: ?action=common_download_main&upload_id=NNNN（PDF等。xlsx等は除外）
 */
const jagesPress: HarvestAdapterDef = {
  key: "jages_press",
  label: "JAGES 研究成果・プレスリリース",
  sourceOrg: "JAGES（日本老年学的評価研究）",
  overseas: false,
  parserVersion: 2, // v2: multidatabase記事対応＋href &amp; デコード（2026-08-25）
  itemLimitPerRun: 5,
  listItems(html, baseUrl) {
    const seen = new Set<string>();
    const items: HarvestListItem[] = [];
    for (const a of extractAnchors(html)) {
      const url = absolutizeUrl(a.href, baseUrl);
      if (!url || !sameHost(url, baseUrl)) continue;

      // (a) 多目的DBの記事詳細リンク
      const contentId = /multidatabase_view_main_detail/.test(url)
        ? url.match(/[?&]content_id=(\d+)/)?.[1]
        : undefined;
      if (contentId) {
        if (isNavText(a.text)) continue;
        const key = `content-${contentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ stableId: key, title: a.text.slice(0, 200), url });
        continue;
      }

      // (b) NetCommonsのファイルダウンロードリンク
      const uploadId = url.match(/[?&]upload_id=(\d+)/)?.[1];
      if (!uploadId || !/common_download_main/.test(url)) continue;
      // 表・タグ一覧等のデータファイルは対象外（本文抽出できない）
      if (/\.(xlsx?|zip|csv|pptx?)\s*$/i.test(a.text)) continue;
      if (isNavText(a.text)) continue;
      const key = `upload-${uploadId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ stableId: key, title: a.text.slice(0, 200), url });
    }
    return items;
  },
  promptHint:
    "JAGES（日本老年学的評価研究）の更新履歴・研究成果ページです。高齢者の社会参加・介護予防に関する" +
    "縦断研究・地域相関研究が中心です。多くは観察研究（qed または case）— 無作為割付の明記が" +
    "無い限り rct にしないこと。効果量（OR/RR/HR/IRR）・追跡年数・対象自治体数と標本規模を丁寧に転記してください。" +
    "開催案内・ニューズレター発行・受賞報告など**研究の効果検証でないページは空配列**で返すこと（無理に拾わない）。",
};

/**
 * mhlw_grants — 厚生労働科学研究成果データベース — X7b・アダプタB
 * 検索結果（base_url に検索クエリを含める）→ /project/{id} → 報告書PDF。
 * PDFはS3へ原本保全し、Tier1ナレッジに自動登録して既存X3フローに合流する。
 */
const mhlwGrants: HarvestAdapterDef = {
  key: "mhlw_grants",
  label: "厚労科研 成果データベース",
  sourceOrg: "厚生労働科学研究成果データベース",
  overseas: false,
  mode: "pdf_to_knowledge",
  itemLimitPerRun: 3, // 報告書PDFは大きいため少なめに（残りは次回のrunで処理）
  listItems(html, baseUrl) {
    const seen = new Set<string>();
    const items: HarvestListItem[] = [];
    for (const a of extractAnchors(html)) {
      const url = absolutizeUrl(a.href, baseUrl);
      if (!url || !sameHost(url, baseUrl)) continue;
      const projectId = url.match(/\/project\/(\d+)/)?.[1];
      if (!projectId) continue;
      if (isNavText(a.text)) continue;
      if (seen.has(projectId)) continue;
      seen.add(projectId);
      items.push({ stableId: `project-${projectId}`, title: a.text.slice(0, 200), url });
    }
    return items;
  },
  resolvePdfUrls(html, pageUrl) {
    return extractPdfLinks(html, pageUrl);
  },
  promptHint: "（アダプタB: 本文のAI抽出は既存のナレッジ抽出タブで行う）",
};

/**
 * wsipp — Washington State Institute for Public Policy: Benefit-Cost Results — X7b・海外
 * プログラム別ページ（/BenefitCost/Program/…）から便益費用・効果量を抽出する。
 * 海外ソース: 外的妥当性メモ（transferability）必須・金額は参考値注記（sanitizeが強制）。
 */
const wsipp: HarvestAdapterDef = {
  key: "wsipp",
  label: "WSIPP Benefit-Cost（米・ワシントン州）",
  sourceOrg: "Washington State Institute for Public Policy (WSIPP)",
  overseas: true,
  itemLimitPerRun: 5,
  listItems(html, baseUrl) {
    const seen = new Set<string>();
    const items: HarvestListItem[] = [];
    for (const a of extractAnchors(html)) {
      const url = absolutizeUrl(a.href, baseUrl);
      if (!url || !sameHost(url, baseUrl)) continue;
      if (!/\/BenefitCost\/Program/i.test(url)) continue;
      if (a.text.length < 8) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ stableId: stableIdOf(url), title: a.text.slice(0, 200), url });
    }
    return items;
  },
  promptHint:
    "WSIPP（米国ワシントン州公共政策研究所）のBenefit-Cost分析ページです（英語）。" +
    "メタ分析ベースの効果量と便益費用比が載っています。日本語で構造化し、" +
    "**transferability（外的妥当性メモ）に米国の制度・対象の前提を必ず書く**こと（無い行は取り込まれません）。" +
    "金額はUSDのまま fiscal_note に通貨を明記（円換算しない）。benefit-cost ratio は fiscal_effect_rate に入れず fiscal_note に記載する（定義が財政効果率と異なるため）。",
};

/**
 * community_guide — The Community Guide（米CDC系・介入推奨）— X7b・海外
 * findings ページ（/findings/…）から推奨・エビデンスを抽出する。
 */
const communityGuide: HarvestAdapterDef = {
  key: "community_guide",
  label: "The Community Guide（米CDC）",
  sourceOrg: "The Guide to Community Preventive Services (The Community Guide)",
  overseas: true,
  itemLimitPerRun: 5,
  listItems(html, baseUrl) {
    const seen = new Set<string>();
    const items: HarvestListItem[] = [];
    for (const a of extractAnchors(html)) {
      const url = absolutizeUrl(a.href, baseUrl);
      if (!url || !sameHost(url, baseUrl)) continue;
      if (!/\/findings\//i.test(url)) continue;
      if (a.text.length < 8) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ stableId: stableIdOf(url), title: a.text.slice(0, 200), url });
    }
    return items;
  },
  promptHint:
    "The Community Guide（米国の予防サービス介入ガイド）の findings ページです（英語）。" +
    "系統的レビューに基づく推奨と効果の要約が載っています（design は多くが sr）。日本語で構造化し、" +
    "**transferability（外的妥当性メモ）に米国の文脈・対象の前提を必ず書く**こと（無い行は取り込まれません）。",
};

// ─── アダプタD: 機械転記の型（X7e）────────────────────────

/** corpus_context への転記行（kind='regional_stat' 等） */
export interface ContextRowInput {
  /** source_key の末尾（webseed:auto:<adapter>: に続く安定ID） */
  stableId: string;
  kind: "policy_package" | "legal_system" | "subsidy_program" | "regional_stat" | "trend";
  title: string;
  body: string;
  pestle_tag: string;
  seven_s_tag: string | null;
  swot_hint: "opportunity" | "threat" | "strength" | "weakness" | "neutral";
  region_scope: "national" | "prefecture" | "municipality";
  region_code: string | null;
  population_band: string | null;
  field_category: string | null;
  source_org: string;
  source_url: string | null;
  published_at: string | null; // YYYY-MM-DD
  source_note: string | null;
}

/** corpus_measures への参照行（source_kind='govreview'。国事業の参考単価） */
export interface MeasureRefInput {
  stableId: string;
  title: string;
  field_category: string | null;
  intervention: string | null;
  outcome_notes: string[];
  total_budget: number | null;
  unit_cost: number | null;
  cost_per_outcome_note: string | null;
  funding: string | null;
  source_note: string;
}

export interface TranscribeResult {
  contextRows: ContextRowInput[];
  measureRefRows: MeasureRefInput[];
  rejected: { title: string; reason: string }[];
}

/** 1回のrunで転記する行の上限（light検収のまとめ承認単位に収める） */
export const MAX_TRANSCRIBE_ROWS = 100;

// ─── アダプタC: 学術API（X7d）─────────────────────────────
// base_url に検索クエリ込みのAPI URLを設定する（別分野は同じアダプタで
// base_url を変えたソース行を追加すればよい）。listItems はAPI応答
// （XML/RSS/JSON）をパースする — エンジンの流れ（取得→ハッシュ差分→
// 新規のみ本文取得）はアダプタAと同じ。

const SCREENING_DISCIPLINE =
  "学術データベースの検索結果由来です。スクリーニングを通過した論文だけが来ます。" +
  "抄録・記事ページの記載だけで判定し、**本文に無い数値を作らない**こと。";

/**
 * j_stage — J-STAGE WebAPI（論文検索・Atom XML）
 * 例: https://api.jstage.jst.go.jp/searchapi/do?service=3&article=介護予防
 * entry: <article_title><ja>…</ja>… / <article_link><ja>URL</ja> / <prism:doi> / <pubyear>
 */
const jStage: HarvestAdapterDef = {
  key: "j_stage",
  label: "J-STAGE（論文検索API）",
  sourceOrg: "J-STAGE（科学技術振興機構）",
  overseas: false,
  screening: true,
  conservativeLevel: true,
  fullTextChase: true,
  itemLimitPerRun: 5,
  listItems(xml) {
    const items: HarvestListItem[] = [];
    const seen = new Set<string>();
    for (const entry of xmlBlocks(xml, "entry")) {
      const title = xmlText(entry, "article_title") ?? xmlText(entry, "title");
      const link = xmlText(entry, "article_link") ?? xmlText(entry, "link");
      if (!title || !link || !/^https?:\/\//.test(link)) continue;
      const doi = xmlText(entry, "prism:doi");
      const stableId = doi ? `doi-${doi.replace(/[^\w.\-/]/g, "_")}` : stableIdOf(link);
      if (seen.has(stableId)) continue;
      seen.add(stableId);
      items.push({ stableId: stableId.slice(-100), title: title.slice(0, 200), url: link });
    }
    return items;
  },
  promptHint:
    SCREENING_DISCIPLINE +
    "J-STAGE掲載の日本語論文の記事ページです。抄録から効果量（OR/RR/差分）・標本規模・追跡期間を転記してください。",
};

/**
 * pubmed — PubMed E-utilities（esearch JSON → 記事ページ）
 * 例: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&sort=pub_date&term=…
 * 応答: {"esearchresult":{"idlist":["12345678",…]}}
 * 海外扱い（overseas=true）: 日本発の論文も含まれるが、外的妥当性メモを常に必須にして安全側に倒す。
 */
const pubmed: HarvestAdapterDef = {
  key: "pubmed",
  label: "PubMed（E-utilities）",
  sourceOrg: "PubMed（米国国立医学図書館）",
  overseas: true,
  screening: true,
  conservativeLevel: true,
  fullTextChase: true,
  itemLimitPerRun: 5,
  listItems(body) {
    const items: HarvestListItem[] = [];
    try {
      const json = JSON.parse(body) as { esearchresult?: { idlist?: unknown } };
      const ids = Array.isArray(json.esearchresult?.idlist) ? json.esearchresult.idlist : [];
      for (const id of ids) {
        if (typeof id !== "string" || !/^\d+$/.test(id)) continue;
        items.push({
          stableId: `pmid-${id}`,
          title: `PMID ${id}`, // 実タイトルは記事ページ取得後にAI抽出が書く（これはログ表示用）
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        });
      }
    } catch {
      return [];
    }
    return items;
  },
  promptHint:
    SCREENING_DISCIPLINE +
    "PubMedの記事ページです（英語）。日本語で構造化し、**transferability（外的妥当性メモ）に" +
    "研究実施国・対象・制度の前提を必ず書く**こと（無い行は取り込まれません）。",
};

/**
 * cinii — CiNii Research OpenSearch（RSS/RDF）
 * 例: https://cir.nii.ac.jp/opensearch/articles?format=rss&count=20&q=…
 * item: <title>…</title> <link>https://cir.nii.ac.jp/crid/…</link>
 */
const cinii: HarvestAdapterDef = {
  key: "cinii",
  label: "CiNii Research（論文検索API）",
  sourceOrg: "CiNii Research（国立情報学研究所）",
  overseas: false,
  screening: true,
  conservativeLevel: true,
  fullTextChase: true,
  itemLimitPerRun: 5,
  listItems(xml) {
    const items: HarvestListItem[] = [];
    const seen = new Set<string>();
    for (const block of xmlBlocks(xml, "item")) {
      const title = xmlText(block, "title");
      const link = xmlText(block, "link");
      if (!title || !link || !/^https?:\/\//.test(link)) continue;
      const crid = link.match(/\/crid\/(\d+)/)?.[1];
      const stableId = crid ? `crid-${crid}` : stableIdOf(link);
      if (seen.has(stableId)) continue;
      seen.add(stableId);
      items.push({ stableId, title: title.slice(0, 200), url: link });
    }
    return items;
  },
  promptHint:
    SCREENING_DISCIPLINE +
    "CiNii Researchの文献ページです。抄録が無い場合は書誌情報から分かる範囲だけを記録し、" +
    "効果量を推測しないでください（レベルと要約のみで登録される）。",
};

// ─── アダプタD: e-Stat（統計API・機械転記）— X7e ──────────

type Rec = Record<string, unknown>;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str$ = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as Rec)["$"] === "string") return (v as Rec)["$"] as string;
  return null;
};

/** e-Stat getStatsData(JSON) 応答から regional_stat 行を機械転記する（純関数） */
export function transcribeEstat(
  body: string,
  queryConfig: Record<string, unknown> | null,
): TranscribeResult {
  const out: TranscribeResult = { contextRows: [], measureRefRows: [], rejected: [] };
  let root: Rec;
  try {
    root = JSON.parse(body) as Rec;
  } catch {
    out.rejected.push({ title: "e-Stat応答", reason: "JSONとして解釈できない" });
    return out;
  }
  const statData = ((root["GET_STATS_DATA"] as Rec | undefined)?.["STATISTICAL_DATA"] ?? null) as Rec | null;
  if (!statData) {
    // 典型: appId 未設定・不正（RESULT.ERROR_MSG が返る）
    const result = (root["GET_STATS_DATA"] as Rec | undefined)?.["RESULT"] as Rec | undefined;
    const msg = typeof result?.["ERROR_MSG"] === "string" ? (result["ERROR_MSG"] as string) : "STATISTICAL_DATA が無い";
    out.rejected.push({ title: "e-Stat応答", reason: msg.slice(0, 200) });
    return out;
  }

  const tableInf = (statData["TABLE_INF"] ?? {}) as Rec;
  const statsDataId = typeof tableInf["@id"] === "string" ? (tableInf["@id"] as string) : "unknown";
  const statName =
    str$(tableInf["TITLE"]) ?? str$(tableInf["STATISTICS_NAME"]) ?? "統計表";

  // 分類マップ（area / time / cat01 → コード→名称）
  const classMaps = new Map<string, Map<string, string>>();
  for (const obj of asArray(((statData["CLASS_INF"] ?? {}) as Rec)["CLASS_OBJ"])) {
    const o = obj as Rec;
    const id = typeof o["@id"] === "string" ? (o["@id"] as string) : null;
    if (!id) continue;
    const m = new Map<string, string>();
    for (const c of asArray(o["CLASS"])) {
      const cc = c as Rec;
      if (typeof cc["@code"] === "string" && typeof cc["@name"] === "string") {
        m.set(cc["@code"] as string, cc["@name"] as string);
      }
    }
    classMaps.set(id, m);
  }
  const nameOf = (cls: string, code: string | null): string | null =>
    code ? (classMaps.get(cls)?.get(code) ?? code) : null;

  const values = asArray(((statData["DATA_INF"] ?? {}) as Rec)["VALUE"]).map((v) => v as Rec);

  // 全国値（area=00000）を {time|cat} で引けるようにする
  const nationalByKey = new Map<string, { value: string; unit: string | null }>();
  for (const v of values) {
    if (v["@area"] !== "00000") continue;
    const key = `${v["@time"] ?? ""}|${v["@cat01"] ?? ""}`;
    const val = str$(v["$"] ?? v);
    if (val != null) {
      nationalByKey.set(key, { value: val, unit: typeof v["@unit"] === "string" ? (v["@unit"] as string) : null });
    }
  }

  const pestle = typeof queryConfig?.["pestle_tag"] === "string" ? (queryConfig["pestle_tag"] as string) : "S";
  const category =
    typeof queryConfig?.["field_category"] === "string" ? (queryConfig["field_category"] as string) : "地域統計";
  const sourceUrl = `https://www.e-stat.go.jp/dbview?sid=${statsDataId}`;

  for (const v of values) {
    if (out.contextRows.length >= MAX_TRANSCRIBE_ROWS) break;
    const area = typeof v["@area"] === "string" ? (v["@area"] as string) : null;
    const val = str$(v["$"] ?? v);
    if (!area || area === "00000" || val == null) continue; // 全国行は比較値としてだけ使う
    const time = typeof v["@time"] === "string" ? (v["@time"] as string) : null;
    const cat = typeof v["@cat01"] === "string" ? (v["@cat01"] as string) : null;
    const unit = typeof v["@unit"] === "string" ? (v["@unit"] as string) : "";
    const areaName = nameOf("area", area) ?? area;
    const timeName = nameOf("time", time);
    const catName = nameOf("cat01", cat);
    const nat = nationalByKey.get(`${time ?? ""}|${cat ?? ""}`);
    const indicator = catName ?? statName;

    // 事実のみのテンプレート文（推測・評価を含めない — 設計 §1-3）
    const body_ =
      `${areaName}の${indicator}は ${val}${unit}${timeName ? `（${timeName}）` : ""}。` +
      (nat ? ` 全国値: ${nat.value}${nat.unit ?? unit}。` : "") +
      ` 出典: e-Stat（statsDataId ${statsDataId}）`;

    out.contextRows.push({
      stableId: `${statsDataId}:${area}:${time ?? "t"}:${cat ?? "c"}`,
      kind: "regional_stat",
      title: `${indicator} — ${areaName}${timeName ? `（${timeName}）` : ""}`.slice(0, 200),
      body: body_.slice(0, 1000),
      pestle_tag: pestle,
      seven_s_tag: null,
      swot_hint: "neutral",
      region_scope: /000$/.test(area) ? "prefecture" : "municipality",
      region_code: area,
      population_band: null,
      field_category: category,
      source_org: "政府統計の総合窓口（e-Stat）",
      source_url: sourceUrl,
      published_at: null,
      source_note: `${statName} / statsDataId ${statsDataId}（機械転記・AI不介在）`,
    });
  }
  return out;
}

const eStat: HarvestAdapterDef = {
  key: "e_stat",
  label: "e-Stat 統計API",
  sourceOrg: "政府統計の総合窓口（e-Stat）",
  overseas: false,
  mode: "transcribe",
  itemLimitPerRun: 1, // transcribe は行単位でなくrun単位（MAX_TRANSCRIBE_ROWS で制御）
  listItems() {
    return [];
  },
  prepareUrl(baseUrl, env) {
    if (/[?&]appId=/.test(baseUrl)) return { url: baseUrl };
    const appId = env["ESTAT_APP_ID"];
    if (!appId) {
      return { error: "ESTAT_APP_ID が設定されていません（e-Stat APIの利用登録とenv追加が必要）" };
    }
    return { url: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}appId=${encodeURIComponent(appId)}` };
  },
  transcribe: transcribeEstat,
  promptHint: "（アダプタD: AI不介在の機械転記）",
};

// ─── アダプタD: 行政事業レビュー（CSV・機械転記）— X7e ────

/** 簡易CSVパース（ダブルクォート・改行内包に対応・純関数） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const numFromCell = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[,，\s円]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * 行政事業レビュー（RSシステム）CSVから govreview 参照行を機械転記する（純関数）。
 * 列はヘッダ名のゆるい一致で自動検出する（列構成の年度差異に耐える）:
 *   事業名 / 事業ID / 府省庁(所管) / 当初予算(予算額) / 執行額 / 成果指標 / 活動指標 / 事業の目的(概要)
 * query_config.budget_unit_yen … 予算列の単位（既定 1,000,000 = 百万円）
 */
export function transcribeGyoseiReview(
  body: string,
  queryConfig: Record<string, unknown> | null,
): TranscribeResult {
  const out: TranscribeResult = { contextRows: [], measureRefRows: [], rejected: [] };
  const rows = parseCsv(body);
  if (rows.length < 2) {
    out.rejected.push({ title: "行政事業レビューCSV", reason: "CSVとして行を読めない（一覧ページのURLのままの可能性）" });
    return out;
  }
  const header = rows[0]!.map((h) => h.trim());
  const findCol = (...words: string[]): number =>
    header.findIndex((h) => words.some((w) => h.includes(w)));

  const cName = findCol("事業名");
  if (cName < 0) {
    out.rejected.push({ title: "行政事業レビューCSV", reason: `ヘッダに「事業名」列が見つからない（先頭行: ${header.slice(0, 8).join(",")}）` });
    return out;
  }
  const cId = findCol("事業ID", "事業番号");
  const cMinistry = findCol("府省庁", "所管", "府省");
  const cYear = findCol("事業年度", "年度");
  const cBudget = findCol("当初予算", "予算額", "歳出予算");
  const cExec = findCol("執行額", "執行率");
  const cPurpose = findCol("事業の目的", "事業概要", "事業の概要");
  const cOutcome = findCol("成果指標");
  const cActivity = findCol("活動指標");

  const unitYen =
    typeof queryConfig?.["budget_unit_yen"] === "number" && queryConfig["budget_unit_yen"] > 0
      ? (queryConfig["budget_unit_yen"] as number)
      : 1_000_000;

  for (const r of rows.slice(1)) {
    if (out.measureRefRows.length >= MAX_TRANSCRIBE_ROWS) break;
    const name = r[cName]?.trim();
    if (!name) continue;
    const id = cId >= 0 ? r[cId]?.trim() : null;
    const year = cYear >= 0 ? r[cYear]?.trim() : null;
    const budgetRaw = cBudget >= 0 ? numFromCell(r[cBudget]) : null;
    const execRaw = cExec >= 0 ? numFromCell(r[cExec]) : null;
    const outcomes: string[] = [];
    if (cOutcome >= 0 && r[cOutcome]?.trim()) outcomes.push(`成果指標: ${r[cOutcome]!.trim()}`.slice(0, 300));
    if (cActivity >= 0 && r[cActivity]?.trim()) outcomes.push(`活動指標: ${r[cActivity]!.trim()}`.slice(0, 300));

    out.measureRefRows.push({
      stableId: (id ? `${id}` : `${name}-${year ?? ""}`).replace(/\s+/g, "-").slice(0, 100),
      title: `${name}${year ? `（${year}）` : ""}`.slice(0, 200),
      field_category: null, // 検収（light）で必要に応じて補完
      intervention: cPurpose >= 0 ? (r[cPurpose]?.trim() || null)?.slice(0, 2000) ?? null : null,
      outcome_notes: outcomes,
      total_budget: budgetRaw != null ? Math.round(budgetRaw * unitYen) : null,
      unit_cost: null, // 単価は積算側で 事業費÷活動量 として扱う（ここでは捏造しない）
      cost_per_outcome_note:
        execRaw != null ? `執行額 ${Math.round(execRaw * unitYen).toLocaleString("ja-JP")}円（行政事業レビュー）` : null,
      funding: cMinistry >= 0 ? r[cMinistry]?.trim() || null : null,
      source_note: `行政事業レビュー（RSシステム）${id ? ` / 事業ID ${id}` : ""}（国事業の参考値・機械転記・AI不介在）`,
    });
  }
  return out;
}

const gyoseiReview: HarvestAdapterDef = {
  key: "gyosei_review",
  label: "行政事業レビュー（RSシステム）",
  sourceOrg: "行政事業レビュー 見える化サイト（RSシステム）",
  overseas: false,
  mode: "transcribe",
  itemLimitPerRun: 1,
  listItems() {
    return [];
  },
  transcribe: transcribeGyoseiReview,
  promptHint: "（アダプタD: AI不介在の機械転記）",
};

// ─── レジストリ ───────────────────────────────────────────

export const HARVEST_ADAPTERS: Record<string, HarvestAdapterDef> = {
  [envBest.key]: envBest,
  [nudgeShare.key]: nudgeShare,
  [jagesPress.key]: jagesPress,
  [mhlwGrants.key]: mhlwGrants,
  [wsipp.key]: wsipp,
  [communityGuide.key]: communityGuide,
  [jStage.key]: jStage,
  [pubmed.key]: pubmed,
  [cinii.key]: cinii,
  [eStat.key]: eStat,
  [gyoseiReview.key]: gyoseiReview,
};

export function getAdapter(key: string): HarvestAdapterDef | null {
  return HARVEST_ADAPTERS[key] ?? null;
}

export const HARVEST_ADAPTER_KEYS = Object.keys(HARVEST_ADAPTERS);
