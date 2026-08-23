"use client";

import { useState } from "react";
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
  upstream_program_evaluation: UpstreamEval | null;
}

interface UpstreamEval {
  id: string;
  evaluation_tier: string;
  fiscal_year: number | null;
  result: string | null;
  achievement_rate: number | null;
  findings: string | null;
  improvement_actions: string | null;
  next_steps: string | null;
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
  /** 計画期間から算出した評価対象年度 */
  fiscalYears: number[];
}

const TIER_LABEL: Record<string, string> = {
  process: "プロセス評価",
  outcome: "アウトカム評価",
  outcome_initial: "短期アウトカム評価",
  outcome_intermediate: "中間アウトカム評価",
  outcome_long: "長期アウトカム評価",
  efficiency: "効率性評価",
};

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



// ---- 印刷（PDF化）----
//
// 以前は jsPDF の helvetica 固定で日本語がすべて文字化けしていた。
// 日本語フォントの埋め込みは数MBになるため、ブラウザの印刷機能に切り替える。
// 「送信先: PDFに保存」で日本語のままPDFになる。

function esc(v: string | null | undefined): string {
  return (v ?? "(未入力)")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function printSheet(sheet: SheetRow, entries: EntryRow[], projectTitle: string) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) {
    alert("ポップアップがブロックされました。ブラウザの設定で許可してください。");
    return;
  }

  const field = (label: string, value: string | null) =>
    `<div class="f"><div class="l">${label}</div><div class="v">${esc(value)}</div></div>`;

  const entryHtml = entries
    .map(
      (e) => `
      <section class="entry">
        <h3>${e.fiscal_year}年度（${e.period_type === "interim" ? "中間" : "最終"}）
          <span class="rating">${RATING_LABELS[e.rating ?? ""] ?? "評価未設定"}</span>
        </h3>
        ${field("実施内容", e.actual_activities)}
        ${field("達成状況の分析", e.achievement_analysis)}
        ${field("取組の妥当性", e.activity_appropriateness)}
        ${field("課題", e.challenges)}
        ${field("対策", e.countermeasures)}
        ${field("次年度の変更点", e.next_year_changes)}
        ${field("都道府県への支援要請", e.prefecture_support_request)}
      </section>`,
    )
    .join("");

  win.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>${esc(sheet.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif;
         color: #111; margin: 0; padding: 24px 28px; line-height: 1.7; font-size: 13px; }
  .proj { font-size: 11px; color: #666; }
  h1 { font-size: 20px; margin: 4px 0 18px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 14px; margin: 22px 0 8px; padding-left: 8px; border-left: 4px solid #555; }
  h3 { font-size: 13px; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid #ccc;
       display: flex; justify-content: space-between; align-items: baseline; }
  .rating { font-size: 11px; font-weight: normal; border: 1px solid #666; padding: 1px 8px; border-radius: 10px; }
  .f { display: grid; grid-template-columns: 130px 1fr; gap: 10px; margin-bottom: 7px;
       page-break-inside: avoid; }
  .l { font-size: 11px; color: #555; }
  .v { font-size: 12px; white-space: pre-wrap; }
  .entry { margin-bottom: 20px; page-break-inside: avoid; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #ccc;
          font-size: 10px; color: #777; }
  @page { size: A4; margin: 14mm; }
  @media print { body { padding: 0; } }
</style></head><body>
  <p class="proj">${esc(projectTitle)}</p>
  <h1>${esc(sheet.title)}</h1>
  <h2>取組の概要</h2>
  ${field("背景・課題", sheet.background)}
  ${field("取組内容", sheet.activities)}
  ${field("目標と指標", sheet.target_and_metrics)}
  ${field("評価方法", sheet.evaluation_method)}
  ${field("評価時期", sheet.evaluation_timing)}
  <h2>年度ごとの評価</h2>
  ${entryHtml || '<p style="font-size:12px;color:#777">評価の記録がありません</p>'}
  <p class="foot">自己評価シート ／ ${new Date().toLocaleDateString("ja-JP")} 出力</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
  win.document.close();
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
          <div className="neu-button-wrap">
            <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50 neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
          </div>
        </PermissionGate>
      </div>
    </div>
  );
}

// ---- メインコンポーネント ----

export default function SelfEvaluationClient({
  project,
  sheets: initialSheets,
  evaluations,
  fiscalYears,
}: Props) {
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

  const saveTitle = async (sheet: SheetRow, title: string) => {
    setSheets((prev) => prev.map((s) => (s.id === sheet.id ? { ...s, title } : s)));
    try {
      await fetch(`/api/admin/projects/${project.id}/self-evaluation/${sheet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      setSheetSaveError((p) => ({ ...p, [sheet.id]: "タイトルの保存に失敗しました" }));
    }
  };

  // 自己評価の対策・次年度の変更点から改善アクションを起票する
  const [issuing, setIssuing] = useState<string | null>(null);
  const issueImprovement = async (entry: EntryRow, sheet: SheetRow) => {
    const seed = [entry.countermeasures, entry.next_year_changes].filter(Boolean).join("\n");
    const title = window.prompt(
      "改善アクションの見出しを入力してください（自己評価の記入内容を引き継いでいます）",
      (seed.split("\n")[0] ?? "").slice(0, 120) || sheet.title,
    );
    if (!title || !title.trim()) return;
    setIssuing(entry.id);
    try {
      const res = await fetch(`/api/admin/projects/${project.id}/improvement-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "self_evaluation",
          self_evaluation_entry_id: entry.id,
          program_evaluation_id: sheet.program_evaluation_id,
          title: title.trim(),
          detail: seed || null,
          fiscal_year: entry.fiscal_year,
        }),
      });
      if (res.ok && confirm("改善アクションを起票しました。管理画面を開きますか？")) {
        window.location.href = `/projects/${project.id}/improvement-actions`;
      }
    } finally {
      setIssuing(null);
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
          <div className="neu-button-wrap">
            <button
            type="button"
            onClick={() => setNewSheetModalOpen(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white neu-button-primary"
            style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
          >
            新規作成
          </button>
          </div>
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
            {/* 上流のプログラム評価（この自己評価が受けている評価結果） */}
            {selectedSheet.upstream_program_evaluation && (
              <div
                className="rounded-2xl border p-5"
                style={{ background: "#6366f110", borderColor: "#6366f140" }}
              >
                <div className="flex items-baseline gap-2 flex-wrap mb-2">
                  <h3 className="text-sm font-semibold" style={{ color: "#a5b4fc" }}>
                    このシートが受けている評価結果
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    {TIER_LABEL[selectedSheet.upstream_program_evaluation.evaluation_tier] ??
                      selectedSheet.upstream_program_evaluation.evaluation_tier}
                    {selectedSheet.upstream_program_evaluation.fiscal_year
                      ? `（${selectedSheet.upstream_program_evaluation.fiscal_year}年度）`
                      : ""}
                    {selectedSheet.upstream_program_evaluation.achievement_rate != null
                      ? ` 到達度 ${selectedSheet.upstream_program_evaluation.achievement_rate}%`
                      : ""}
                  </span>
                </div>
                <dl className="space-y-2">
                  {([
                    ["評価結果", selectedSheet.upstream_program_evaluation.result],
                    ["所見", selectedSheet.upstream_program_evaluation.findings],
                    ["改善策", selectedSheet.upstream_program_evaluation.improvement_actions],
                    ["次のステップ", selectedSheet.upstream_program_evaluation.next_steps],
                  ] as const)
                    .filter(([, v]) => !!v)
                    .map(([label, v]) => (
                      <div key={label}>
                        <dt className="text-[10px] text-slate-500">{label}</dt>
                        <dd className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                          {v}
                        </dd>
                      </div>
                    ))}
                </dl>
                <p className="text-[10px] text-slate-500 mt-3">
                  プログラム評価の結果を踏まえて、この取組の自己評価を記入してください。
                </p>
              </div>
            )}

            {/* シート詳細フォーム */}
            <div className="rounded-2xl border p-5 space-y-4" style={cardStyle}>
              <div className="flex items-center justify-between">
                <h2
                  className="text-lg font-semibold text-slate-100"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    // 以前はローカル state を書き換えるだけで PATCH を送っておらず、
                    // 変更したタイトルが保存されていなかった
                    const val = (e.currentTarget.textContent ?? "").trim();
                    if (val && val !== selectedSheet.title) {
                      void saveTitle(selectedSheet, val);
                    } else if (!val) {
                      e.currentTarget.textContent = selectedSheet.title;
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
                        printSheet(selectedSheet, selectedSheet.entries, project.title)
                      }
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors duration-200"
                      style={{
                        borderColor: "var(--border)",
                        color: "#94a3b8",
                      }}
                    >
                      印刷 / PDF保存
                    </button>
                  </PermissionGate>
                  <PermissionGate module="self_evaluation" level="edit" projectId={project.id}>
                    <div className="neu-button-wrap">
                      <button
                      type="button"
                      onClick={() => void handleSheetSave(selectedSheet)}
                      disabled={sheetSaving[selectedSheet.id]}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 neu-button-primary"
                      style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
                    >
                      {sheetSaving[selectedSheet.id] ? "保存中..." : "保存"}
                    </button>
                    </div>
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

                      {/* 対策・次年度の変更点を、追跡できる改善アクションに変える */}
                      {entry && (entry.countermeasures || entry.next_year_changes) && (
                        <PermissionGate module="self_evaluation" level="edit" projectId={project.id}>
                          <div
                            className="mt-4 pt-3 flex items-center justify-between gap-3 flex-wrap"
                            style={{ borderTop: "1px solid var(--border)" }}
                          >
                            <p className="text-[11px] text-slate-500 leading-snug">
                              記入した対策・次年度の変更点は、そのままでは追跡されません。改善アクションとして起票すると反映先まで追えます。
                            </p>
                            <button
                              type="button"
                              onClick={() => void issueImprovement(entry, selectedSheet)}
                              disabled={issuing === entry.id}
                              className="text-[11px] px-3 py-1.5 rounded-lg font-medium whitespace-nowrap disabled:opacity-50 shrink-0"
                              style={{ background: "#b4530918", color: "#f59e0b", border: "1px solid #b4530940" }}
                            >
                              {issuing === entry.id ? "起票中..." : "改善を起票"}
                            </button>
                          </div>
                        </PermissionGate>
                      )}
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
              <div className="neu-button-wrap">
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
        </div>
      )}
    </div>
  );
}
