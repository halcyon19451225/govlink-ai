/**
 * 対話履歴の書き出し（純粋関数・client/server 両用）。
 *
 * 担当者がAIの問いや対話全体を庁内の他の資料へ持ち出したり、
 * 別のAIに相談したりするために、素のテキストへ整形する。
 * 画面のコピーボタン（components/CopyButton.tsx）から使う。
 */

export interface TranscriptMessage {
  role: "user" | "assistant";
  content: string;
  step?: string;
}

export const ROLE_LABEL: Record<TranscriptMessage["role"], string> = {
  user: "担当者",
  assistant: "AI",
};

export interface TranscriptOptions {
  /** 先頭に付ける見出し（例: 「課題仮説設定 — 主観的幸福感」） */
  title?: string;
  /** 工程キー → 表示名（例: problems → 問題の洗い出し） */
  stepLabel?: (step: string) => string;
}

/** 1件ぶんの見出し（例: 「【AI・問題の洗い出し】」） */
export function formatMessageHeading(
  m: TranscriptMessage,
  stepLabel?: TranscriptOptions["stepLabel"],
): string {
  const step = m.step ? (stepLabel ? stepLabel(m.step) : m.step) : "";
  return `【${ROLE_LABEL[m.role]}${step ? `・${step}` : ""}】`;
}

/** 1件ぶんを見出し付きのテキストにする */
export function formatMessage(
  m: TranscriptMessage,
  stepLabel?: TranscriptOptions["stepLabel"],
): string {
  return `${formatMessageHeading(m, stepLabel)}\n${m.content.trim()}`;
}

/**
 * 対話全体をテキストにする。
 * 空の発言は落とす（AIの応答待ちで生じた空行を持ち出さないため）。
 */
export function formatTranscript(
  messages: TranscriptMessage[],
  opts: TranscriptOptions = {},
): string {
  const body = messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => formatMessage(m, opts.stepLabel))
    .join("\n\n");
  const head = opts.title ? `# ${opts.title}\n\n` : "";
  return `${head}${body}`.trimEnd() + "\n";
}
