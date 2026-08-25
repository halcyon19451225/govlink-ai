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
  /**
   * 処理系統。省略時は 'extract'（アダプタA）。
   * 'pdf_to_knowledge'（アダプタB）は item のページ/PDFを S3 に原本保全し
   * Tier1ナレッジへ自動登録する（コーパスへの直接投入はしない）。
   */
  mode?: "extract" | "pdf_to_knowledge";
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
 * jages_press — JAGES（日本老年学的評価研究）プレスリリース — X7b
 * NetCommons形式: `?action=common_download_main&upload_id=NNNN` の直接ダウンロード
 * （実体は主にPDF。エンジンが content-type で判別して本文抽出する）。
 * webseed第1弾（JAGES介護予防）の継続供給源。
 */
const jagesPress: HarvestAdapterDef = {
  key: "jages_press",
  label: "JAGES プレスリリース",
  sourceOrg: "JAGES（日本老年学的評価研究）",
  overseas: false,
  itemLimitPerRun: 5,
  listItems(html, baseUrl) {
    const seen = new Set<string>();
    const items: HarvestListItem[] = [];
    for (const a of extractAnchors(html)) {
      const url = absolutizeUrl(a.href, baseUrl);
      if (!url || !sameHost(url, baseUrl)) continue;
      // NetCommonsのファイルダウンロードリンクだけを対象にする
      const uploadId = url.match(/[?&]upload_id=(\d+)/)?.[1];
      if (!uploadId || !/common_download_main/.test(url)) continue;
      // 表・タグ一覧等のデータファイルは対象外（本文抽出できない）
      if (/\.(xlsx?|zip|csv|pptx?)\s*$/i.test(a.text)) continue;
      if (isNavText(a.text)) continue;
      if (seen.has(uploadId)) continue;
      seen.add(uploadId);
      items.push({ stableId: `upload-${uploadId}`, title: a.text.slice(0, 200), url });
    }
    return items;
  },
  promptHint:
    "JAGES（日本老年学的評価研究）のプレスリリースです。高齢者の社会参加・介護予防に関する" +
    "縦断研究・地域相関研究が中心です。多くは観察研究（qed または prepost）— 無作為割付の明記が" +
    "無い限り rct にしないこと。効果量（OR/RR/HR/IRR）・追跡年数・対象自治体数と標本規模を丁寧に転記してください。",
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
};

export function getAdapter(key: string): HarvestAdapterDef | null {
  return HARVEST_ADAPTERS[key] ?? null;
}

export const HARVEST_ADAPTER_KEYS = Object.keys(HARVEST_ADAPTERS);
