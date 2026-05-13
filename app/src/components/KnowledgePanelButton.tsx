"use client";

import { useState } from "react";
import KnowledgePanel from "@/components/KnowledgePanel";

export default function KnowledgePanelButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-medium px-5 py-2 rounded-xl border hover:border-indigo-500/40 hover:text-indigo-400 transition-all duration-200 text-slate-400"
        style={{ borderColor: "#2a2d3a" }}
      >
        📚 ナレッジ
      </button>
      <KnowledgePanel projectId={projectId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
