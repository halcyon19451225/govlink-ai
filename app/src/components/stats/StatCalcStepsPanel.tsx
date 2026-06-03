"use client";

import { useState } from "react";

interface StatCalcStepsPanelProps {
  steps: object;
  title?: string;
}

export default function StatCalcStepsPanel({
  steps,
  title = "計算ステップ",
}: StatCalcStepsPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-lg border mt-2"
      style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-300 transition-colors duration-200"
      >
        <span className="font-medium">{title}</span>
        <span className="font-mono">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <pre
          className="text-xs font-mono px-3 pb-3 text-slate-400 overflow-x-auto"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {JSON.stringify(steps, null, 2)}
        </pre>
      )}
    </div>
  );
}
