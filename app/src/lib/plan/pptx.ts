import "server-only";
import PptxGenJS from "pptxgenjs";
import type { DeckSlide } from "@/lib/plan/deck";

/**
 * 受益者向け説明資料の pptx レンダラ（PL4 P④）— サーバーサイド生成（純JS・Amplifyで動く）
 *
 * - **addNotes() でスライドごとのノート欄に読み原稿**（話し言葉・1枚45〜60秒目安）
 *   → Libera の pptx→ナレーション動画エンジン（ノート欄=ナレーション原稿）の入力形式と一致
 * - テーマは最小1テーマ（自治体名＋アクセント色）。ロゴ・配色の本格対応は
 *   layout の拡張余地として確保（設計どおり）
 * - フォントは名前参照のみ（游ゴシック既定 — 埋め込まない。PowerPoint側で描画）
 */

export interface DeckMeta {
  title: string;
  municipalityName: string;
  generatedOn: string; // YYYY-MM-DD
}

export interface DeckLayout {
  /** アクセント色（6桁hex・#なし。既定: インディゴ） */
  accent_color?: string;
  /** フォント名参照（既定: 游ゴシック） */
  font_family?: string;
  /** 表紙の差出（既定: 自治体名） */
  publisher?: string;
}

const HEX6 = /^[0-9A-Fa-f]{6}$/;

export async function buildAudienceDeck(
  meta: DeckMeta,
  slides: DeckSlide[],
  layout: DeckLayout,
): Promise<Buffer> {
  const accent = layout.accent_color && HEX6.test(layout.accent_color) ? layout.accent_color.toUpperCase() : "4F46E5";
  const font = layout.font_family ?? "游ゴシック";
  const publisher = layout.publisher ?? meta.municipalityName;

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625 インチ
  pres.theme = { headFontFace: font, bodyFontFace: font };

  const coverSlide = slides.find((s) => s.id === "cover");
  const contentSlides = slides.filter((s) => s.id !== "cover");

  // ── 表紙 ─────────────────────────────────────
  {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape("rect", { x: 0, y: 0, w: 10, h: 0.35, fill: { color: accent } });
    s.addText(meta.title, {
      x: 0.6, y: 1.7, w: 8.8, h: 1.4,
      fontSize: 34, bold: true, color: "1F2937", fontFace: font, align: "center",
    });
    if (coverSlide && coverSlide.bullets.length > 0) {
      s.addText(coverSlide.bullets.join(" ／ "), {
        x: 0.8, y: 3.0, w: 8.4, h: 0.7,
        fontSize: 16, color: "4B5563", fontFace: font, align: "center",
      });
    }
    s.addText(`${publisher}　${meta.generatedOn}`, {
      x: 0.8, y: 4.6, w: 8.4, h: 0.5,
      fontSize: 14, color: "6B7280", fontFace: font, align: "center",
    });
    s.addShape("rect", { x: 0, y: 5.27, w: 10, h: 0.35, fill: { color: accent } });
    if (coverSlide?.note) s.addNotes(coverSlide.note);
  }

  // ── 本文スライド ─────────────────────────────
  for (const slide of contentSlides) {
    const s = pres.addSlide();
    s.background = { color: "FFFFFF" };
    // 見出し帯
    s.addShape("rect", { x: 0, y: 0, w: 10, h: 0.95, fill: { color: accent } });
    s.addText(slide.title, {
      x: 0.45, y: 0.08, w: 9.1, h: 0.8,
      fontSize: 22, bold: true, color: "FFFFFF", fontFace: font, valign: "middle",
    });
    // 箇条書き（多い場合は文字を少し詰める）
    const bullets = slide.bullets.length > 0 ? slide.bullets : ["（内容未作成 — 生成または編集で埋めてください）"];
    const fontSize = bullets.length > 6 ? 14 : 17;
    s.addText(
      bullets.map((b) => ({
        text: b,
        options: { bullet: { code: "2022", indent: 12 }, breakLine: true },
      })),
      {
        x: 0.6, y: 1.25, w: 8.8, h: 3.9,
        fontSize, color: "1F2937", fontFace: font, valign: "top",
        paraSpaceAfter: 8,
      },
    );
    // フッター（差出）
    s.addText(publisher, {
      x: 0.6, y: 5.28, w: 8.8, h: 0.3,
      fontSize: 10, color: "9CA3AF", fontFace: font, align: "right",
    });
    // ノート欄 = 読み原稿
    if (slide.note) s.addNotes(slide.note);
  }

  const out = await pres.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
