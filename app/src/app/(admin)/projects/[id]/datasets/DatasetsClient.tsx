"use client";

import { useState } from "react";

interface ProjectRow {
  id: string;
  title: string;
  plan_type: string | null;
}

interface DatasetDef {
  id: string;
  display_name: string;
  description: string;
  data_format: string;
  required_columns: string[];
  plan_types: string[];
  used_by_modules: string[];
  ai_analysis_types: string[];
  data_sensitivity: string;
  update_frequency: string;
  source_description: string;
}

interface ProjectDataset {
  id: string;
  project_id: string;
  dataset_def_id: string;
  file_name: string;
  s3_key: string;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  survey_year: number | null;
  status: string;
  validation_errors: unknown;
  row_count: number | null;
  metadata: unknown;
}

const cardStyle = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border)" };

export default function DatasetsClient({
  project,
  defs,
  uploaded,
}: {
  project: ProjectRow;
  defs: DatasetDef[];
  uploaded: ProjectDataset[];
}) {
  const [uploadedList] = useState<ProjectDataset[]>(uploaded);
  const [modalDef, setModalDef] = useState<DatasetDef | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [surveyYear, setSurveyYear] = useState<string>(
    String(new Date().getFullYear()),
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadedCount = uploadedList.length;
  const totalCount = defs.length;
  const progress = totalCount > 0 ? (uploadedCount / totalCount) * 100 : 0;

  const getUploaded = (defId: string): ProjectDataset | undefined =>
    uploadedList.find((u) => u.dataset_def_id === defId);

  const openModal = (def: DatasetDef) => {
    setModalDef(def);
    setFile(null);
    setSurveyYear(String(new Date().getFullYear()));
    setUploadError(null);
  };

  const closeModal = () => {
    setModalDef(null);
    setUploadError(null);
  };

  const handleUpload = async () => {
    if (!modalDef || !file) {
      setUploadError("ファイルを選択してください");
      return;
    }
    setUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dataset_def_id", modalDef.id);
      formData.append("survey_year", surveyYear);

      const res = await fetch(`/api/admin/projects/${project.id}/datasets`, {
        method: "POST",
        body: formData,
      });

      const json = (await res.json()) as {
        data: { id: string; s3_key: string } | null;
        error: string | null;
      };

      if (!res.ok || json.error) {
        setUploadError(json.error ?? "アップロードに失敗しました");
        return;
      }

      // Reload page to reflect new upload
      window.location.reload();
    } catch {
      setUploadError("ネットワークエラーが発生しました");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">{project.title}</h1>
        <p className="text-sm text-slate-500 mt-1">データセット管理</p>
      </div>

      {/* 充足度サマリー */}
      <div className="rounded-2xl border p-5" style={cardStyle}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-slate-300">
            データセット充足度
          </span>
          <span className="text-sm text-slate-400">
            アップロード済み:{" "}
            <span className="font-bold text-slate-100">{uploadedCount}</span>{" "}
            / {totalCount}
          </span>
        </div>
        <div
          className="h-2.5 rounded-full overflow-hidden"
          style={{ background: "var(--border)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, #6366f1, #06b6d4)",
            }}
          />
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {Math.round(progress)}% 完了
        </p>
      </div>

      {/* データセット定義カード一覧 */}
      <div className="grid gap-4 md:grid-cols-2">
        {defs.map((def) => {
          const existing = getUploaded(def.id);
          return (
            <div
              key={def.id}
              className="rounded-2xl border p-5 flex flex-col gap-3"
              style={cardStyle}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100 truncate">
                    {def.display_name}
                  </h3>
                  <p
                    className="text-xs text-slate-400 mt-1 leading-relaxed"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {def.description}
                  </p>
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded border whitespace-nowrap flex-shrink-0"
                  style={{
                    borderColor: "var(--border)",
                    color: "#94a3b8",
                    background: "var(--bg-input)",
                  }}
                >
                  {def.data_format.toUpperCase()}
                </span>
              </div>

              {/* 必須カラム */}
              {def.required_columns.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {def.required_columns.slice(0, 5).map((col) => (
                    <span
                      key={col}
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "var(--border)", color: "#64748b" }}
                    >
                      {col}
                    </span>
                  ))}
                  {def.required_columns.length > 5 && (
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "var(--border)", color: "#64748b" }}
                    >
                      +{def.required_columns.length - 5}
                    </span>
                  )}
                </div>
              )}

              {/* アップロード済み / 未アップロード */}
              {existing ? (
                <div className="flex items-center justify-between mt-auto pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-0">
                    <p className="text-xs text-slate-300 truncate">
                      {existing.file_name}
                    </p>
                    {existing.survey_year != null && (
                      <p className="text-xs text-slate-500">
                        {existing.survey_year}年度
                      </p>
                    )}
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ml-2"
                    style={{
                      borderColor: "#10b98140",
                      color: "#10b981",
                      background: "#10b98110",
                    }}
                  >
                    ✓ 済
                  </span>
                </div>
              ) : (
                <div className="mt-auto pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => openModal(def)}
                    className="w-full text-xs font-semibold px-3 py-2 rounded-lg border transition-colors duration-200 hover:border-indigo-500/40 hover:text-indigo-400 text-slate-400"
                    style={{ borderColor: "var(--border)" }}
                  >
                    アップロード
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* アップロードモーダル */}
      {modalDef && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <div
            className="rounded-2xl border p-6 w-full max-w-md shadow-2xl neu-card"
            style={cardStyle}
          >
            <h2 className="text-base font-bold text-slate-100 mb-1">
              {modalDef.display_name}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {modalDef.description}
            </p>

            {/* 必須カラム */}
            <div className="mb-4">
              <p className="text-xs font-medium text-slate-400 mb-2">
                必須カラム
              </p>
              <div className="flex flex-wrap gap-1">
                {modalDef.required_columns.map((col) => (
                  <span
                    key={col}
                    className="text-xs px-2 py-0.5 rounded font-mono"
                    style={{ background: "var(--border)", color: "#94a3b8" }}
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  ファイル（
                  {modalDef.data_format === "csv" ? "CSV" : "Excel"} 形式）
                </label>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-500/20 file:text-indigo-400 hover:file:bg-indigo-500/30 cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  調査年度
                </label>
                <input
                  type="number"
                  value={surveyYear}
                  onChange={(e) => setSurveyYear(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  min={2000}
                  max={2100}
                />
              </div>
            </div>

            {uploadError && (
              <p className="text-xs text-red-400 mt-3">{uploadError}</p>
            )}

            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={closeModal}
                disabled={uploading}
                className="flex-1 text-sm font-medium px-4 py-2 rounded-xl border transition-colors duration-200 text-slate-400 hover:text-slate-300"
                style={{ borderColor: "var(--border)" }}
              >
                キャンセル
              </button>
              <div className="neu-button-wrap flex-1">
                <button
                type="button"
                onClick={() => void handleUpload()}
                disabled={uploading || !file}
                className="w-full text-sm font-semibold px-4 py-2 rounded-xl text-white transition-all duration-200 disabled:opacity-50 neu-button-primary"
                style={{
                  background: "linear-gradient(135deg, #6366f1, #06b6d4)",
                }}
              >
                {uploading ? "アップロード中..." : "アップロード"}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
