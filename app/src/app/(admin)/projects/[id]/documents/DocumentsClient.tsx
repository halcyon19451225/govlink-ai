"use client";

import { useState, useEffect, useRef } from "react";

interface TaskRow {
  id: string;
  title: string;
}

interface DocumentRow {
  id: string;
  schedule_task_id: string | null;
  title: string;
  document_type: string;
  s3_key: string;
  file_name: string;
  file_size: number | null;
  ai_summary: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

const DOC_TYPE_OPTIONS = [
  { value: "advisory_report", label: "諮問報告書" },
  { value: "meeting_minutes", label: "議事録" },
  { value: "survey_report", label: "調査報告書" },
  { value: "plan", label: "計画書" },
  { value: "other", label: "その他" },
];

const DOC_TYPE_BADGE: Record<string, string> = {
  advisory_report: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  meeting_minutes: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  survey_report: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  plan: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  other: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};

const TABS = ["すべて", ...DOC_TYPE_OPTIONS.map((o) => o.label)];
const TAB_VALUES = ["all", ...DOC_TYPE_OPTIONS.map((o) => o.value)];

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const cardStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };

export default function DocumentsClient({
  projectId,
  tasks,
}: {
  projectId: string;
  tasks: TaskRow[];
}) {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [summarizing, setSummarizing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("other");
  const [taskId, setTaskId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const res = await fetch(`/api/admin/documents?projectId=${projectId}`);
    const json = (await res.json()) as { data: DocumentRow[]; error: string | null };
    if (json.data) setDocs(json.data);
  };

  useEffect(() => { void load(); }, []);

  const filtered = activeTab === 0
    ? docs
    : docs.filter((d) => d.document_type === TAB_VALUES[activeTab]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError("ファイルを選択してください"); return; }
    setUploading(true);
    setError(null);

    try {
      const metaRes = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          scheduleTaskId: taskId || null,
          title,
          documentType: docType,
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });
      const metaJson = (await metaRes.json()) as {
        data: { id: string; presignedUrl: string } | null;
        error: string | null;
      };
      if (!metaRes.ok || !metaJson.data) {
        setError(metaJson.error ?? "登録に失敗しました");
        return;
      }

      await fetch(metaJson.data.presignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });

      setTitle("");
      setDocType("other");
      setTaskId("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch {
      setError("アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const handleSummarize = async (docId: string) => {
    setSummarizing(docId);
    try {
      const res = await fetch(`/api/admin/documents/${docId}/summarize`, { method: "POST" });
      const json = (await res.json()) as { data: { summary: string } | null; error: string | null };
      if (!res.ok) { setError(json.error ?? "要約に失敗しました"); return; }
      await load();
    } catch {
      setError("要約の生成に失敗しました");
    } finally {
      setSummarizing(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* アップロードフォーム */}
      <form
        onSubmit={handleUpload}
        className="rounded-2xl border p-6 space-y-4"
        style={cardStyle}
      >
        <h3 className="text-sm font-semibold text-slate-300">ドキュメントをアップロード</h3>

        {error && (
          <div
            className="rounded-lg border px-4 py-3 text-sm text-red-400"
            style={{ background: "#ef444410", borderColor: "#ef444430" }}
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              タイトル <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              style={inputStyle}
              placeholder="例: 第1回諮問委員会議事録"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">ドキュメント種別</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              {DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "var(--bg-secondary)" }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">関連タスク（任意）</label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="" style={{ background: "var(--bg-secondary)" }}>なし</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id} style={{ background: "var(--bg-secondary)" }}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              ファイル <span className="text-red-400">*</span>
              <span className="ml-1 text-slate-500 font-normal">（PDF・Word・Excel）</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:text-slate-300 file:cursor-pointer transition-colors duration-200"
              style={{ ...inputStyle, padding: "6px 12px" }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="text-white px-5 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-lg shadow-indigo-500/20 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          {uploading ? "アップロード中..." : "アップロード"}
        </button>
      </form>

      {/* タブ + 一覧 */}
      <div>
        <div className="flex gap-1 mb-4 flex-wrap">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors duration-200 ${
                activeTab === i
                  ? "text-slate-100 font-medium"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
              style={activeTab === i ? { background: "#ffffff10" } : {}}
            >
              {tab}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-10 text-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm text-slate-500">ドキュメントがまだありません</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                className="rounded-xl border p-5"
                style={cardStyle}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${DOC_TYPE_BADGE[doc.document_type] ?? DOC_TYPE_BADGE.other}`}
                      >
                        {DOC_TYPE_OPTIONS.find((o) => o.value === doc.document_type)?.label ?? "その他"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(doc.uploaded_at).toLocaleDateString("ja-JP")}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-100">{doc.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{doc.file_name}</p>
                  </div>
                  {!doc.ai_summary && (
                    <button
                      onClick={() => handleSummarize(doc.id)}
                      disabled={summarizing === doc.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors duration-200 text-cyan-400 hover:text-cyan-300 disabled:opacity-40 shrink-0"
                      style={{ borderColor: "#06b6d430", background: "#06b6d410" }}
                    >
                      {summarizing === doc.id ? "生成中..." : "AI要約を生成"}
                    </button>
                  )}
                </div>

                {doc.ai_summary && (
                  <div
                    className="mt-3 rounded-lg px-3 py-2.5 border-l-2"
                    style={{ background: "#06b6d410", borderLeftColor: "#06b6d4" }}
                  >
                    <p className="text-xs font-semibold text-cyan-400 mb-1">AIサマリー</p>
                    <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
                      {doc.ai_summary}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
