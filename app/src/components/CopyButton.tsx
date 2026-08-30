"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * クリップボードへコピーする。
 *
 * navigator.clipboard は https / localhost（セキュアコンテキスト）でしか使えず、
 * 庁内からの閲覧環境によっては落ちることがあるため、
 * 旧来の textarea + execCommand へフォールバックする。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // フォールバックへ
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

type Variant = "ghost" | "outline";

export default function CopyButton({
  text,
  label,
  title,
  variant = "ghost",
  className = "",
}: {
  /** コピーする本文。関数を渡すと押した時点で組み立てる（長い対話履歴向け） */
  text: string | (() => string);
  /** 通常時のラベル。省略すると 📋 だけのアイコンボタンになる */
  label?: string;
  title?: string;
  variant?: Variant;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handle = useCallback(async () => {
    const body = typeof text === "function" ? text() : text;
    const ok = await copyToClipboard(body);
    setState(ok ? "done" : "error");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  }, [text]);

  const shown =
    state === "done" ? "コピーしました" : state === "error" ? "コピーできません" : label;
  const color = state === "done" ? "#10b981" : state === "error" ? "#f87171" : undefined;

  return (
    <button
      type="button"
      onClick={() => void handle()}
      title={title ?? (label ? undefined : "クリップボードにコピー")}
      aria-label={title ?? label ?? "クリップボードにコピー"}
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors hover:brightness-125 ${className}`}
      style={{
        color: color ?? "var(--text-secondary, #94a3b8)",
        background: variant === "outline" ? "var(--bg-primary)" : "transparent",
        border: variant === "outline" ? "1px solid var(--border)" : "1px solid transparent",
      }}
    >
      <span aria-hidden="true">{state === "done" ? "✓" : "📋"}</span>
      {shown && (
        <span role="status" className="whitespace-nowrap">
          {shown}
        </span>
      )}
    </button>
  );
}
