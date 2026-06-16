// Node.js ESM スクリプト: stdin からPDFバイトを受け取り、テキストをstdoutに出力
// Next.jsのバンドル外で実行されるため pdfjs-dist ESM が正常動作する
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "module";
import { readFileSync } from "fs";

const req = createRequire(import.meta.url);
const workerMjs = req
  .resolve("pdfjs-dist/package.json")
  .replace("package.json", "legacy/build/pdf.worker.mjs");
GlobalWorkerOptions.workerSrc = `file://${workerMjs}`;

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const buffer = Buffer.concat(chunks);
const uint8 = new Uint8Array(buffer);

try {
  const doc = await getDocument({ data: uint8 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => it.str).join(" "));
  }
  const text = pages.join("\n");
  process.stdout.write(text);
  process.exit(0);
} catch (e) {
  process.stderr.write(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
