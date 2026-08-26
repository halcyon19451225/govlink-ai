"use client";

/**
 * マニュアル本文のレンダラ（M1）— ドロワーと /manual ページで共用
 * - Markdown は marked（npm同梱）で描画
 * - ```mermaid ブロックは mermaid を**開いたときだけ動的import**して描画
 *   （バンドル本体を重くしない・CDN不使用 — 既存方針どおり）
 * - 本文はリポジトリ内の正本（src/content/manual）のみ — 外部入力は描画しない
 */

import { useEffect, useRef, useState } from "react";
import { marked } from "marked";

let mermaidSeq = 0;

export default function ManualView({ body }: { body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState("");

  useEffect(() => {
    const parsed = marked.parse(body, { async: false });
    setHtml(typeof parsed === "string" ? parsed : "");
  }, [body]);

  useEffect(() => {
    if (!ref.current || !html) return;
    const blocks = Array.from(ref.current.querySelectorAll("code.language-mermaid"));
    if (blocks.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        for (const code of blocks) {
          if (cancelled) return;
          const src = code.textContent ?? "";
          const container = code.closest("pre") ?? code;
          try {
            const { svg } = await mermaid.render(`manual-mmd-${++mermaidSeq}`, src);
            const div = document.createElement("div");
            div.className = "manual-mermaid";
            div.innerHTML = svg;
            container.replaceWith(div);
          } catch {
            // 描画に失敗した図はソースのまま残す（本文は読める）
          }
        }
      } catch {
        /* mermaid の読み込み失敗 — 図はコードのまま表示 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={ref}
      className="manual-body"
      // 本文はリポジトリ管理の正本のみを描画する（ユーザー入力は通らない）
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
