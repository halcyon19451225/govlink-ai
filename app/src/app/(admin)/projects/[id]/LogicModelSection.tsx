"use client";

import { useState } from "react";
import UpgradeModal from "../../../../components/UpgradeModal";

export interface LogicModel {
  inputs: string[];
  activities: string[];
  outputs: string[];
  short_outcomes: string[];
  long_outcomes: string[];
}

interface Kpi {
  label: string;
  target: number;
  unit: string;
}

interface Props {
  projectId: string;
  projectTitle: string;
  projectDescription: string;
  kpis: Kpi[];
  initialLogicModel: LogicModel | null;
}

const COLUMNS: {
  key: keyof LogicModel;
  label: string;
  color: string;
}[] = [
  { key: "inputs", label: "投入資源", color: "#6366f1" },
  { key: "activities", label: "実施活動", color: "#818cf8" },
  { key: "outputs", label: "産出物", color: "#06b6d4" },
  { key: "short_outcomes", label: "短期成果", color: "#10b981" },
  { key: "long_outcomes", label: "長期成果", color: "#0d9488" },
];

function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  return text.trim();
}

function parseLogicModel(text: string): LogicModel | null {
  try {
    const obj = JSON.parse(extractJson(text)) as Record<string, unknown>;
    if (
      Array.isArray(obj.inputs) &&
      Array.isArray(obj.activities) &&
      Array.isArray(obj.outputs) &&
      Array.isArray(obj.short_outcomes) &&
      Array.isArray(obj.long_outcomes)
    ) {
      return obj as unknown as LogicModel;
    }
    return null;
  } catch {
    return null;
  }
}

function LogicModelDiagram({ model }: { model: LogicModel }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex items-start gap-2 min-w-max pb-2">
        {COLUMNS.map((col, idx) => (
          <div key={col.key} className="flex items-start gap-2">
            <div className="w-44 flex-shrink-0">
              {/* グラデーションヘッダー */}
              <div
                className="text-xs font-semibold px-3 py-2 rounded-t-lg text-center text-white"
                style={{ background: col.color }}
              >
                {col.label}
              </div>
              {/* アイテムリスト */}
              <div
                className="border-x border-b rounded-b-lg p-2 space-y-1.5 min-h-[80px]"
                style={{ background: "#12151f", borderColor: "var(--border)" }}
              >
                {model[col.key].map((item, i) => (
                  <div
                    key={i}
                    className="text-xs text-slate-300 rounded px-2 py-1.5 leading-snug"
                    style={{ background: "var(--bg-secondary)" }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
            {idx < COLUMNS.length - 1 && (
              <div className="flex-shrink-0 flex items-start pt-9">
                <span className="text-slate-600 text-2xl leading-none select-none">→</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LogicModelSection({
  projectId,
  projectTitle,
  projectDescription,
  kpis,
  initialLogicModel,
}: Props) {
  const [model, setModel] = useState<LogicModel | null>(initialLogicModel);
  const [generating, setGenerating] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setCharCount(0);

    try {
      const res = await fetch("/api/ai/generate-logic-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: projectTitle,
          description: projectDescription,
          kpis,
        }),
      });

      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({ error: null }))) as {
          error: string | null; upgrade_url?: string;
        };
        if (res.status === 403 && json.upgrade_url) {
          setShowUpgrade(json.error ?? "AI生成回数の上限に達しました");
        } else {
          setError(json.error ?? "生成に失敗しました");
        }
        setGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.includes("__ERROR__:")) {
          setError(chunk.replace("__ERROR__:", "").trim());
          setGenerating(false);
          return;
        }
        accumulated += chunk;
        setCharCount(accumulated.length);
      }

      const parsed = parseLogicModel(accumulated);
      if (parsed) {
        setModel(parsed);
      } else {
        setError("レスポンスのJSON解析に失敗しました。再度お試しください。");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
    {showUpgrade && <UpgradeModal message={showUpgrade} onClose={() => setShowUpgrade(null)} />}
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          AIロジックモデル
        </h3>
        <div className="neu-button-wrap">
          <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {generating ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              生成中{charCount > 0 && `（${charCount}文字）`}
            </>
          ) : model ? (
            "再生成する"
          ) : (
            "AIロジックモデルを生成"
          )}
        </button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-lg border px-4 py-3 text-sm text-red-400 mb-3"
          style={{ background: "#ef444410", borderColor: "#ef444430" }}
        >
          {error}
        </div>
      )}

      {model ? (
        <div
          className="rounded-2xl border p-5"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
            boxShadow: "0 2px 16px rgba(0,0,0,0.25)",
          }}
        >
          <LogicModelDiagram model={model} />
        </div>
      ) : !generating ? (
        <div
          className="rounded-2xl border border-dashed p-8 text-center"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm text-slate-500">
            「AIロジックモデルを生成」ボタンを押すと、政策情報をもとにロジックモデルを自動生成します。
          </p>
        </div>
      ) : null}
    </section>
    </>
  );
}
