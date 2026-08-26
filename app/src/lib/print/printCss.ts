/**
 * 帳票印刷の共通CSS（PL3で新設・純粋）
 *
 * jsPDF の helvetica 固定で日本語が文字化けした反省から、帳票のPDF化は
 * **ブラウザ印刷（window.print → 「送信先: PDFに保存」）**方式に統一する。
 * 自己評価シート（先行実装）と評価報告書の印刷ビューはこのCSSを共用する。
 * 使い方: window.open したポップアップの <style> にこの文字列を入れる。
 */

export const PRINT_BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
         color: #111; margin: 0; padding: 24px 28px; line-height: 1.7; font-size: 13px; }
  .proj { font-size: 11px; color: #666; }
  h1 { font-size: 20px; margin: 4px 0 18px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 14px; margin: 22px 0 8px; padding-left: 8px; border-left: 4px solid #555; }
  h3 { font-size: 13px; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid #ccc;
       display: flex; justify-content: space-between; align-items: baseline; }
  .rating { font-size: 11px; font-weight: normal; border: 1px solid #666; padding: 1px 8px; border-radius: 10px; }
  .f { display: grid; grid-template-columns: 130px 1fr; gap: 10px; margin-bottom: 7px;
       page-break-inside: avoid; }
  .l { font-size: 11px; color: #555; }
  .v { font-size: 12px; white-space: pre-wrap; }
  .entry { margin-bottom: 20px; page-break-inside: avoid; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #ccc;
          font-size: 10px; color: #777; }
  /* 表（評価報告書のKPI達成状況・施策別評価・改善一覧） */
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; page-break-inside: avoid; }
  th, td { border: 1px solid #999; padding: 4px 7px; font-size: 11px; text-align: left; vertical-align: top; }
  th { background: #f0f0f4; font-weight: 600; }
  ul, ol { margin: 4px 0 10px; padding-left: 22px; }
  li { font-size: 12px; margin-bottom: 2px; }
  p { margin: 4px 0 10px; font-size: 12px; }
  .chapter { margin-bottom: 18px; }
  .src { font-size: 10px; color: #777; }
  .note { font-size: 10px; color: #777; }
  @page { size: A4; margin: 14mm; }
  @media print { body { padding: 0; } }
`;
