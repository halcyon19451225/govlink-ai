"use client";

interface DatasetItem {
  id: string;
  dataset_def_id: string;
  file_name: string;
  uploaded_at: string;
  survey_year: number | null;
}

interface ArtifactLineagePanelProps {
  projectId: string;
  moduleName: string;
  datasets: DatasetItem[];
  onClose: () => void;
}

export default function ArtifactLineagePanel({
  moduleName,
  datasets,
  onClose,
}: ArtifactLineagePanelProps) {
  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-50 flex flex-col shadow-2xl"
      style={{ background: "#1a1d27", borderLeft: "1px solid #2a2d3a" }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "#2a2d3a" }}
      >
        <div>
          <p className="text-xs text-slate-500">データ系譜</p>
          <h3 className="text-sm font-semibold text-slate-100">{moduleName}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 transition-colors duration-200 text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {datasets.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">
            使用データセットなし
          </p>
        ) : (
          datasets.map((ds) => (
            <div
              key={ds.id}
              className="rounded-lg border p-3"
              style={{ borderColor: "#2a2d3a", background: "#161922" }}
            >
              <p className="text-xs font-medium text-slate-200 truncate">
                {ds.file_name}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {ds.survey_year != null && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded border"
                    style={{
                      borderColor: "#6366f140",
                      color: "#818cf8",
                      background: "#6366f110",
                    }}
                  >
                    {ds.survey_year}年度
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  {new Date(ds.uploaded_at).toLocaleDateString("ja-JP")}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 truncate">
                ID: {ds.dataset_def_id}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
