"use client";

import { useState } from "react";
import jsPDF from "jspdf";
import PermissionGate from "@/components/PermissionGate";

// ---- 型定義 ----

interface EntryRow {
  id: string;
  sheet_id: string;
  fiscal_year: number;
  period_type: "interim" | "final";
  actual_activities: string | null;
  rating: "achieved" | "mostly_achieved" | "not_achieved" | "ongoing" | null;
  rating_label: string | null;
  achievement_analysis: string | null;
  activity_appropriateness: string | null;
  improvement_status: string | null;
  ideal_gap: string | null;
  challenges: string | null;
  countermeasures: string | null;
  next_year_changes: string | null;
  prefecture_support_request: string | null;
  created_at: string;
}

interface SheetRow {
  id: string;
  project_id: string;
  checkpoint_id: string | null;
  program_evaluation_id: string | null;
  title: string;
  has_interim_review: boolean;
  background: string | null;
  activities: string | null;
  target_and_metrics: string | null;
  evaluation_method: string | null;
  evaluation_timing: string | null;
  created_at: string;
  entries: EntryRow[];
}

interface EvalRef {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
}

interface Props {
  project: { id: string; title: string };
  sheets: SheetRow[];
  evaluations: EvalRef[];
}

// ---- 定数 ----

const RATING_LABELS: Record<string, string> = {
  achieved: "達成",
  mostly_achieved: "概ね達成",
  not_achieved: "未達成",
  ongoing: "継続中",
};

const RATING_COLORS: Record<string, string> = {
  achieved: "#10b981",
  mostly_achieved: "#6366f1",
  not_achieved: "#ef4444",
  ongoing: "#f59e0b",
};

const cardStyle: React.CSSProperties = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
const inputStyle: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)" };
const textareaClass = `${inputClass} resize-vertical`;

const FISCAL_YEAR_COUNT = 3;

function getDefaultFiscalYears(): number[] {
  const base = new Date().getFullYear();
  return [base - 1, base, base + 1];
}

// ---- PDF出力 ----

function exportToPDF(sheet: SheetRow, entries: EntryRow[], projectTitle: string) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  const addText = (text: string, fontSize: number, bold = false) => {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text || "", contentW);
    if (y + lines.length * (fontSize * 0.352 + 2) > 280) {
      doc.addPage();
      y = margin;
    }
    doc.text(lines, margin, y);
    y += lines.length * (fontSize * 0.352 + 2) + 3;
  };

  addText(projectTitle, 10);
  addText(sheet.title, 16, true);
  y += 3;
  addText("【背景・課題】", 11, true);
  addText(sheet.background || "(未入力)", 10);
  addText("【取組内容】", 11, true);
  addText(sheet.activities || "(未入力)", 10);
  addText("【目標と指標】", 11, true);
  addText(sheet.target_and_metrics || "(未入力)", 10);

  for (const entry of entries) {
    if (y > 240) {
      doc.addPage();
      y = margin;
    }
    addText(
      `${entry.fiscal_year}年度 (${entry.period_type === "interim" ? "中間" : "最終"})`,
      12,
      true,
    );
    addText(`評価: ${RATING_LABELS[entry.rating ?? ""] ?? ""}`, 10);
    addText(`実績: ${entry.actual_activities || "(未入力)"}`, 10);
    addText(`達成分析: ${entry.achievement_analysis || "(未入力)"}`, 10);
    addText(`課題: ${entry.challenges || "(未入力)"}`, 10);
  }

  doc.save(`self-evaluation-${sheet.id.slice(0, 8)}.pdf`);
}

// ---- エントリーフォーム ----

interface EntryFormProps {
  projectId: string;
  sheetId: string;
  fiscalYear: number;
  periodType: "interim" | "final";
  existing: EntryRow | undefined;
  onSaved: (entry: EntryRow) => void;
}

function EntryForm({ projectId, sheetId, fiscalYear, periodType, existing, onSaved }: EntryFormProps) {
  const [form, setForm] = useState({
    actual_activities: existing?.actual_activities ?? "",
    rating: existing?.rating ?? ("" as string),
    achievement_analysis: existing?.achievement_analysis ?? "",
    challenges: existing?.challenges ?? "",
    countermeasures: existing?.countermeasures ?? "",
    next_year_changes: existing?.next_year_changes ?? "",
    prefecture_support_request: existing?.prefecture_support_request ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setF = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        fiscal_year: fiscalYear,
        period_type: periodType,
        actual_activities: form.actual_activities || null,
        rating: form.rating || null,
        achievement_analysis: form.achievement_analysis || null,
        challenges: form.challenges || null,
        countermeasures: form.countermeasures || null,
        next_year_changes: form.next_year_changes || null,
        prefecture_support_request: form.prefecture_support_request || null,
      };
      const res = await fetch(
        `/api/admin/projects/${projectId}/self-evaluation/${sheetId}/entries`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as { data: EntryRow | null; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      if (json.data) onSaved(json.data);
    } catch {
      setError("ネットワークエラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-slate-400 mb-1 block">実施内容</label>
        <textarea
          value={form.actual_activities}
          onChange={(e) => setF("actual_activities", e.target.value)}
          className={textareaClass}
          style={inputStyle}
          rows={3}
          placeholder="実際に実施した取組内容"
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-2 block">評価</label>
        <div className="flex flex-wrap gap-2">
          {(["achieved", "mostly_achieved", "not_achieved", "ongoing"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setF("rating", r)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-200 border"
              style={{
                background: form.rating === r ? `${RATING_COLORS[r]}20` : "transparent",
                color: form.rating === r ? RATING_COLORS[r] : "#64748b",
                borderColor: form.rating === r ? `${RATING_COLORS[r]}50` : "var(--border)",
              }}
            >
              {RATING_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">達成分析</label>
        <textarea
          value={form.achievement_analysis}
          onChange={(e) => setF("achievement_analysis", e.target.value)}
          className={textareaClass}
          style={inputStyle}
          rows={2}
          placeholder="目標の達成状況と要因分析"
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">課題</label>
        <textarea
          value={form.challenges}
          onChange={(e) => setF("challenges", e.target.value)}
          className={textareaClass}
          style={inputStyle}
          rows={2}
          placeholder="残存課題・問題点"
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">対策</label>
        <textarea
          value={form.countermeasures}
          onChange={(e) => setF("countermeasures", e.target.value)}
          className={textareaClass}
          style={inputStyle}
          rows={2}
          placeholder="課題への対応策"
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">次年度の変更点</label>
        <textarea
          value={form.next_year_changes}
          onChange={(e) => setF("next_year_changes", e.target.value)}
          className={textareaClass}
          style={inputStyle}
          rows={2}
          placeholder="次年度計画への反映事項"
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 mb-1 block">都道府県への支援要請</label>
        <textarea
          value={form.prefecture_support_request}
          onChange={(e) => setF("prefecture_support_request", e.target.value)}
          className={textareaClass}
          style={inputStyle}
          rows={2}
          placeholder="都道府県への支援依頼事項"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex justify-end">
        <PermissionGate module="self_evaluation" level="edit" projectId={projectId}>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </PermissionGate>
      </div>
    </div>
  );
}

// ---- メインコンポーネント ----

export default function SelfEvaluationClient({ project, sheets: initialSheets, evaluations }: Props) {
  const [sheets, setSheets] = useState<SheetRow[]>(initialSheets);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(
    initialSheets[0]?.id ?? null,
  );
  const [newSheetModalOpen, setNewSheetModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBackground, setNewBackground] = useState("");
  const [newProgramEvalId, setNewProgramEvalId] = useState("");
  const [creatingSheet, setCreatingSheet] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [sheetForm, setSheetForm] = useState<
    Record<
      string,
      { background: string; activities: string; target_and_metrics: string; evaluation_method: string; evaluation_timing: string }
    >
  >({});
  const [sheetSaving, setSheetSaving] = useState<Record<string, boolean>>({});
  const [sheetSaveError, setSheetSaveError] = useState<Record<string, string | null>>({});

  const [activeEntryTab, setActiveEntryTab] = useState<Record<string, "interim" | "final">>({});

  const fiscalYears = getDefaultFiscalYears().slice(0, FISCAL_YEAR_COUNT);

  const selectedSheet = sheets.find((s) => s.id === selectedSheetId) ?? null;

  const getSheetFormVal = (sheet: SheetRow) =>
    sheetForm[sheet.id] ?? {
      background: sheet.background ?? "",
      activities: sheet.activities ?? "",
      target_and_metrics: sheet.target_and_metrics ?? "",
      evaluation_method: sheet.evaluation_method ?? "",
      evaluation_timing: sheet.evaluation_timing ?? "",
    };

  const setSheetField = (
    sheetId: string,
    field: string,
    value: string,
    sheet: SheetRow,
  ) => {
    setSheetForm((prev) => ({
      ...prev,
      [sheetId]: { ...getSheetFormVal(sheet), ...prev[sheetId], [field]: value },
    }));
  };

  const handleSheetSave = async (sheet: SheetRow) => {
    setSheetSaving((p) => ({ ...p, [sheet.id]: true }));
    setSheetSaveError((p) => ({ ...p, [sheet.id]: null }));
    try {
      const form = getSheetFormVal(sheet);
      const res = await fetch(
        `/api/admin/projects/${project.id}/self-evaluation/${sheet.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setSheetSaveError((p) => ({ ...p, [sheet.id]: json.error ?? "保存に失敗しました" }));
        return;
      }
      setSheets((prev) =>
        prev.map((s) => (s.id === sheet.id ? { ...s, ...form } : s)),
      );
    } catch {
      setSheetSaveError((p) => ({ ...p, [sheet.id]: "ネットワークエラーが発生しました" }));
    } finally {
      setSheetSaving((p) => ({ ...p, [sheet.id]: false }));
    }
  };

  const handleCreateSheet = async () => {
    if (!newTitle.trim()) return;
    setCreatingSheet(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = {
        title: newTitle.trim(),
        background: newBackground || null,
        program_evaluation_id: newProgramEvalId || null,
      };
      const res = await fetch(`/api/admin/projects/${project.id}/self-evaluation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || json.error) {
        setCreateError(json.error ?? "作成に失敗しました");
        return;
      }
      const listRes = await fetch(`/api/admin/projects/${project.id}/self-evaluation`);
      const listJson = (await listRes.json()) as {
        data: SheetRow[] | null;
        error: string | null;
      };
      if (listJson.data) {
        setSheets(listJson.data);
        if (json.data) setSelectedSheetId(json.data.id);
      }
      setNewSheetModalOpen(false);
      setNewTitle("");
      setNewBackground("");
      setNewProgramEvalId("");
    } catch {
      setCreateError("ネットワークエラーが発生しました");
    } finally {
      setCreatingSheet(false);
    }
  };

  const handleEntrySaved = (sheetId: string, entry: EntryRow) => {
    setSheets((prev) =>
      prev.map((s) => {
        if (s.id !== sheetId) return s;
        const existing = s.entries.findIndex(
          (e) => e.fiscal_year === entry.fiscal_year && e.period_type === entry.period_type,
        );
        if (existing >= 0) {
          const entries = [...s.entries];
          entries[existing] = entry;
          return { ...s, entries };
        }
        return { ...s, entries: [...s.entries, entry] };
      }),
    );
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-220px)] min-h-[600px]">
      {/* 左パネル: シート一覧 */}
      <div
        className="w-72 shrink-0 rounded-2xl border flex flex-col"
        style={cardStyle}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold text-slate-200">シート一覧</h3>
          <button
            type="button"
            onClick={() => setNewSheetModalOpen(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            新規作成
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sheets.length === 0 ? (
            <p className="text-xs text-slate-500 p-4 text-center">シートがありません</p>
          ) : (
            sheets.map((sheet) => (
              <button
                key={sheet.id}
                type="button"
                onClick={() => setSelectedSheetId(sheet.id)}
                className="w-full text-left px-4 py-3 border-b transition-colors duration-200"
                style={{
                  borderColor: "var(--border)",
                  background:
                    selectedSheetId === sheet.id ? "rgba(99,102,241,0.08)" : "transparent",
                }}
              >
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: selectedSheetId === sheet.id ? "#a5b4fc" : "#cbd5e1" }}
                >
                  {sheet.title}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date(sheet.created_at).toLocaleDateString("ja-JP")}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 右パネル: シート詳細 */}
      <div className="flex-1 overflow-y-auto space-y-6">
        {!selectedSheet ? (
          <div
            className="rounded-2xl border border-dashed p-12 text-center h-full flex items-center justify-center"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm text-slate-500">左からシートを選択、または新規作成してください</p>
          </div>
        ) : (
          <>
            {/* シート詳細フォーム */}
            <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
              <div className="flex items-center justify-between">
                <h2
                  className="text-lg font-semibold text-slate-100"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const val = e.currentTarget.textContent ?? "";
                    if (val !== selectedSheet.title) {
                      setSheets((prev) =>
                        prev.map((s) =>
                          s.id === selectedSheet.id ? { ...s, title: val } : s,
                        ),
                      );
                    }
                  }}
                >
                  {selectedSheet.title}
                </h2>
                <div className="flex items-center gap-2">
                  <PermissionGate module="self_evaluation" level="view" projectId={project.id}>
                    <button
                      type="button"
                      onClick={() =>
                        exportToPDF(selectedSheet, selectedSheet.entries, project.title)
                      }
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors duration-200"
                      style={{
                        borderColor: "var(--border)",
                        color: "#94a3b8",
                      }}
                    >
                      PDFエクスポート
                    </button>
                  </PermissionGate>
                  <PermissionGate module="self_evaluation" level="edit" projectId={project.id}>
                    <button
                      type="button"
                      onClick={() => void handleSheetSave(selectedSheet)}
                      disabled={sheetSaving[selectedSheet.id]}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 neu-button-primary"
                      style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                    >
                      {sheetSaving[selectedSheet.id] ? "保存中..." : "保存"}
                    </button>
                  </PermissionGate>
                </div>
              </div>

              {sheetSaveError[selectedSheet.id] && (
                <p className="text-xs text-red-400">{sheetSaveError[selectedSheet.id]}</p>
              )}

              {[
                { field: "background", label: "背景・課題" },
                { field: "activities", label: "取組内容" },
                { field: "target_and_metrics", label: "目標と指標" },
                { field: "evaluation_method", label: "評価方法" },
                { field: "evaluation_timing", label: "評価時期" },
              ].map(({ field, label }) => (
                <div key={field}>
                  <label className="text-xs text-slate-400 mb-1 block">{label}</label>
                  <textarea
                    value={getSheetFormVal(selectedSheet)[field as keyof ReturnType<typeof getSheetFormVal>]}
                    onChange={(e) =>
                      setSheetField(selectedSheet.id, field, e.target.value, selectedSheet)
                    }
                    className={textareaClass}
                    style={inputStyle}
                    rows={3}
                    placeholder={`${label}を入力`}
                  />
                </div>
              ))}
            </div>

            {/* エントリーセクション */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                評価記録
              </h3>
              {fiscalYears.map((year) => {
                const periodType = activeEntryTab[`${selectedSheet.id}-${year}`] ?? "interim";
                const entry = selectedSheet.entries.find(
                  (e) => e.fiscal_year === year && e.period_type === periodType,
                );
                return (
                  <div key={year} className="rounded-2xl border" style={cardStyle}>
                    <div
                      className="px-5 py-3 border-b flex items-center justify-between"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <h4 className="text-sm font-semibold text-slate-200">{year}年度</h4>
                      {selectedSheet.has_interim_review && (
                        <div className="flex gap-1">
                          {(["interim", "final"] as const).map((pt) => (
                            <button
                              key={pt}
                              type="button"
                              onClick={() =>
                                setActiveEntryTab((p) => ({
                                  ...p,
                                  [`${selectedSheet.id}-${year}`]: pt,
                                }))
                              }
                              className="px-3 py-1 rounded-lg text-xs font-medium transition-colors duration-200"
                              style={{
                                background: periodType === pt ? "#6366f120" : "transparent",
                                color: periodType === pt ? "#818cf8" : "#64748b",
                                border: `1px solid ${periodType === pt ? "#6366f140" : "var(--border)"}`,
                              }}
                            >
                              {pt === "interim" ? "中間評価" : "最終評価"}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      {entry && (
                        <div
                          className="mb-4 rounded-xl border px-3 py-2"
                          style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}
                        >
                          <span className="text-xs text-slate-400">現在の評価: </span>
                          {entry.rating ? (
                            <span
                              className="text-xs font-semibold"
                              style={{ color: RATING_COLORS[entry.rating] }}
                            >
                              {RATING_LABELS[entry.rating]}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-600">未設定</span>
                          )}
                        </div>
                      )}
                      <EntryForm
                        projectId={project.id}
                        sheetId={selectedSheet.id}
                        fiscalYear={year}
                        periodType={periodType}
                        existing={entry}
                        onSaved={(e) => handleEntrySaved(selectedSheet.id, e)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 新規シート作成モーダル */}
      {newSheetModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewSheetModalOpen(false);
          }}
        >
          <div
            className="rounded-2xl border w-full max-w-md p-6 space-y-4 neu-card"
            style={cardStyle}
          >
            <h3 className="text-base font-semibold text-slate-100">新規自己評価シート</h3>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">タイトル *</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className={inputClass}
                style={inputStyle}
                placeholder="シートタイトル"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 mb-1 block">背景・課題（任意）</label>
              <textarea
                value={newBackground}
                onChange={(e) => setNewBackground(e.target.value)}
                className={textareaClass}
                style={inputStyle}
                rows={3}
                placeholder="取組の背景と課題"
              />
            </div>

            {evaluations.length > 0 && (
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  関連プログラム評価（任意）
                </label>
                <select
                  value={newProgramEvalId}
                  onChange={(e) => setNewProgramEvalId(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                >
                  <option value="">なし</option>
                  {evaluations.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.evaluation_tier} {ev.fiscal_year ? `(${ev.fiscal_year}年度)` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {createError && <p className="text-xs text-red-400">{createError}</p>}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setNewSheetModalOpen(false);
                  setCreateError(null);
                }}
                className="text-sm px-4 py-2 rounded-xl border text-slate-400 hover:text-slate-300 transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleCreateSheet()}
                disabled={creatingSheet || !newTitle.trim()}
                className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50 neu-button-primary"
                style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
              >
                {creatingSheet ? "作成中..." : "作成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
