import "server-only";
import { MAX_EXTRACTED_CHARS, CHUNK_CHAR_SIZE } from "./knowledge-config";

export interface ExtractResult {
  text: string;
  truncated: boolean;
}

export async function extractText(
  buffer: Buffer,
  fileType: string,
): Promise<ExtractResult> {
  let text: string;

  try {
    if (fileType === "pdf") {
      // pdfjs-dist は Next.js バンドル内で動作しないため子プロセスで実行
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spawnSync } = require("child_process") as typeof import("child_process");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const workerScript: string = require("path").join(process.cwd(), "src/lib/pdf-extract-worker.mjs");
      const result = spawnSync("node", [workerScript], { input: buffer, maxBuffer: 50 * 1024 * 1024 });
      if (result.status !== 0) {
        throw new Error(result.stderr?.toString() || "不明なエラー");
      }
      text = result.stdout?.toString() ?? "";
      if (!text || text.trim().length === 0) {
        throw new Error("テキストが空です（画像PDFの可能性があります）");
      }
    } else if (fileType === "docx") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth") as {
        extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
      };
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      if (!text || text.trim().length === 0) {
        throw new Error("テキストが空です");
      }
    } else if (fileType === "txt") {
      text = buffer.toString("utf-8");
    } else {
      throw new Error(`未対応のファイル形式です: ${fileType}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (fileType === "pdf") {
      throw new Error(
        `PDFのテキスト抽出に失敗しました。画像PDFの可能性があります（詳細: ${msg}）`,
      );
    } else if (fileType === "docx") {
      throw new Error(`Wordファイルのテキスト抽出に失敗しました（詳細: ${msg}）`);
    }
    throw new Error(`テキスト抽出に失敗しました（詳細: ${msg}）`);
  }

  const truncated = text.length > MAX_EXTRACTED_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_EXTRACTED_CHARS) : text,
    truncated,
  };
}

/**
 * テキストを CHUNK_CHAR_SIZE 以下のチャンクに分割する。
 * 改行・句点・読点・スペースを優先して区切る。
 */
export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHAR_SIZE) return [text];

  const chunks: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    if (pos + CHUNK_CHAR_SIZE >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }

    const end = pos + CHUNK_CHAR_SIZE;
    // 改行・句点・読点・全角スペースで区切れる場所を後ろから探す
    const searchStart = Math.max(pos + Math.floor(CHUNK_CHAR_SIZE * 0.7), pos + 1);
    const candidates = ["\n", "。", "、", "．", "，", " ", "　"];
    let bestCut = -1;

    for (let i = end; i >= searchStart; i--) {
      if (candidates.includes(text[i] ?? "")) {
        bestCut = i + 1;
        break;
      }
    }

    if (bestCut <= pos) bestCut = end; // 区切れなければ強制カット
    chunks.push(text.slice(pos, bestCut));
    pos = bestCut;
  }

  return chunks.filter((c) => c.trim().length > 0);
}
