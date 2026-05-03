"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface ResourceRow {
  id: string;
  resource_type: "advisory_board" | "meeting" | "tool" | "other";
  name: string;
  purpose: string | null;
  contact: string | null;
  schedule_pattern: string | null;
  notes: string | null;
}

const TYPE_META = {
  advisory_board: { label: "諮問機関", badge: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30" },
  meeting:        { label: "会議体",   badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
  tool:           { label: "ツール",   badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  other:          { label: "その他",   badge: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
} as const;

type ResourceType = keyof typeof TYPE_META;

const ALL_TYPES: ResourceType[] = ["advisory_board", "meeting", "tool", "other"];

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "#12151f", borderColor: "#2a2d3a" };

interface ModalProps {
  onClose: () => void;
  onSaved: () => void;
}

function AddResourceModal({ onClose, onSaved }: ModalProps) {
  const [type, setType] = useState<ResourceType>("advisory_board");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [contact, setContact] = useState("");
  const [schedulePattern, setSchedulePattern] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("名称は必須です");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource_type: type,
          name: name.trim(),
          purpose: purpose.trim() || undefined,
          contact: contact.trim() || undefined,
          schedule_pattern: schedulePattern.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "登録に失敗しました");
        return;
      }
      onSaved();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border p-6 space-y-4"
        style={{ background: "#1a1d27", borderColor: "#2a2d3a", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-100">組織リソースを追加</h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-xl leading-none transition-colors duration-200"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              className="rounded-lg border px-4 py-3 text-sm text-red-400"
              style={{ background: "#ef444410", borderColor: "#ef444430" }}
            >
              {error}
            </div>
          )}

          {/* タイプ */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">種別</label>
            <div className="flex flex-wrap gap-2">
              {ALL_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200 ${
                    type === t ? TYPE_META[t].badge : "bg-transparent text-slate-500 border-slate-700"
                  }`}
                >
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          {/* 名称 */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例：○○審議会"
            />
          </div>

          {/* 目的 */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">目的・役割</label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例：政策立案に関する答申"
            />
          </div>

          {/* 担当者・連絡先 */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">担当者・連絡先</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例：総務課 山田"
            />
          </div>

          {/* 開催パターン */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">開催パターン</label>
            <input
              type="text"
              value={schedulePattern}
              onChange={(e) => setSchedulePattern(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例：毎月第2火曜日"
            />
          </div>

          {/* 備考 */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">備考</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputClass}
              style={inputStyle}
              placeholder="その他の情報"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="text-white px-5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
            >
              {submitting ? "登録中..." : "登録する"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-slate-500 hover:text-slate-300 px-4 py-2 inline-flex items-center transition-colors duration-200"
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface Props {
  initialResources: ResourceRow[];
}

export default function ResourcesClient({ initialResources }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeType, setActiveType] = useState<ResourceType | "all">("all");
  const [showModal, setShowModal] = useState(false);

  const handleSaved = () => {
    setShowModal(false);
    startTransition(() => router.refresh());
  };

  const filtered =
    activeType === "all"
      ? initialResources
      : initialResources.filter((r) => r.resource_type === activeType);

  const countByType = (t: ResourceType) =>
    initialResources.filter((r) => r.resource_type === t).length;

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">組織リソース管理</h2>
          <p className="text-sm text-slate-500 mt-1">諮問機関・会議体・ツールなどを登録して政策に活用できます</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="text-white text-sm font-semibold px-5 py-2 rounded-xl hover:opacity-90 transition-all duration-200 shadow-lg shadow-indigo-500/20"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          + リソースを追加
        </button>
      </div>

      {/* タブ */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveType("all")}
          className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200 ${
            activeType === "all"
              ? "bg-slate-500/20 text-slate-200 border-slate-500/30"
              : "bg-transparent text-slate-500 border-slate-700 hover:text-slate-300"
          }`}
        >
          すべて ({initialResources.length})
        </button>
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setActiveType(t)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200 ${
              activeType === t
                ? TYPE_META[t].badge
                : "bg-transparent text-slate-500 border-slate-700 hover:text-slate-300"
            }`}
          >
            {TYPE_META[t].label} ({countByType(t)})
          </button>
        ))}
      </div>

      {/* リスト */}
      {filtered.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed p-10 text-center"
          style={{ borderColor: "#2a2d3a" }}
        >
          <p className="text-sm text-slate-500">リソースがまだ登録されていません</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-3 text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
          >
            最初のリソースを追加する →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((r) => {
            const meta = TYPE_META[r.resource_type];
            return (
              <div
                key={r.id}
                className="rounded-xl border p-5 space-y-3 hover:-translate-y-0.5 transition-transform duration-200"
                style={{
                  background: "#1a1d27",
                  borderColor: "#2a2d3a",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-100 leading-tight">{r.name}</h3>
                  <span
                    className={`text-xs px-2.5 py-0.5 rounded-full border font-medium whitespace-nowrap flex-shrink-0 ${meta.badge}`}
                  >
                    {meta.label}
                  </span>
                </div>

                {r.purpose && (
                  <p className="text-sm text-slate-400 leading-relaxed">{r.purpose}</p>
                )}

                <div className="space-y-1.5">
                  {r.contact && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-slate-500 w-20 flex-shrink-0">担当</span>
                      <span className="text-slate-300">{r.contact}</span>
                    </div>
                  )}
                  {r.schedule_pattern && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-slate-500 w-20 flex-shrink-0">開催</span>
                      <span className="text-slate-300">{r.schedule_pattern}</span>
                    </div>
                  )}
                  {r.notes && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-slate-500 w-20 flex-shrink-0">備考</span>
                      <span className="text-slate-400 leading-relaxed">{r.notes}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && <AddResourceModal onClose={() => setShowModal(false)} onSaved={handleSaved} />}
    </div>
  );
}
