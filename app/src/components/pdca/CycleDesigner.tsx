"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { TemplateWithCycles, PdcaCycleDef, PdcaCheckpointDef } from "@/lib/templates";

// ─── 定数 ────────────────────────────────────────────────────────────────────

const CELL_WIDTH = 56; // px per month
const LANE_LABEL_WIDTH = 200; // px

const PHASE_COLORS: Record<string, string> = {
  P: "#6366f1",
  D: "#06b6d4",
  C: "#f59e0b",
  A: "#10b981",
  "P-D": "#8b5cf6",
  "C-A": "#f97316",
};

const EVALUATION_TIER_OPTIONS = [
  { value: "needs", label: "ニーズ評価" },
  { value: "theory", label: "セオリー評価" },
  { value: "process", label: "プロセス評価" },
  { value: "outcome_initial", label: "初期アウトカム評価" },
  { value: "outcome_intermediate", label: "中間アウトカム評価" },
  { value: "cost_efficiency", label: "費用効率評価" },
];

const QC_STEP_OPTIONS = [
  { value: "insurer_will", label: "保険者の意思" },
  { value: "status_check", label: "現状把握" },
  { value: "task_selection", label: "課題選定" },
  { value: "factor_analysis", label: "要因分析" },
  { value: "measure_planning", label: "施策立案" },
  { value: "action", label: "実施" },
  { value: "effect_check", label: "効果確認" },
  { value: "dc_continue", label: "DC継続" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface CycleDesignerProps {
  template: TemplateWithCycles;
  readOnly?: boolean;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getPhaseColor(phase: string): string {
  return PHASE_COLORS[phase] ?? "#64748b";
}

function colIndex(planYear: number, monthStart: number): number {
  return planYear * 12 + (monthStart - 1);
}

function cardWidth(monthStart: number, monthEnd: number | null): number {
  const span = monthEnd != null ? monthEnd - monthStart + 1 : 1;
  return span * CELL_WIDTH - 4;
}

// ─── CheckpointCard ───────────────────────────────────────────────────────────

interface CheckpointCardProps {
  cp: PdcaCheckpointDef;
  cyclePhase: string;
  isSelected: boolean;
  readOnly: boolean;
  onClick: () => void;
}

function CheckpointCard({ cp, cyclePhase, isSelected, readOnly, onClick }: CheckpointCardProps) {
  const color = getPhaseColor(cyclePhase);
  const width = cardWidth(cp.month_start, cp.month_end);
  const col = colIndex(cp.plan_year, cp.month_start);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cp.id,
    disabled: readOnly,
    data: { cp },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: col * CELL_WIDTH + 2,
        top: 6,
        width,
        height: 44,
        background: isSelected ? `${color}30` : "var(--bg-secondary)",
        border: `1.5px solid ${isSelected ? color : color + "80"}`,
        borderRadius: 8,
        cursor: readOnly ? "pointer" : "grab",
        opacity: isDragging ? 0.4 : 1,
        zIndex: isSelected ? 10 : 1,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        paddingLeft: 8,
        paddingRight: 8,
        userSelect: "none",
      }}
      onClick={onClick}
      {...(readOnly ? {} : { ...attributes, ...listeners })}
    >
      <span
        style={{
          fontSize: 11,
          color: "#e2e8f0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 500,
        }}
      >
        {cp.name}
      </span>
    </div>
  );
}

// ─── DroppableCell ────────────────────────────────────────────────────────────

function DroppableCell({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        inset: 0,
        background: isOver ? "rgba(99,102,241,0.12)" : "transparent",
        transition: "background 150ms",
        borderRadius: 4,
        pointerEvents: "all",
      }}
    />
  );
}

// ─── CheckpointEditPanel ──────────────────────────────────────────────────────

interface CheckpointEditPanelProps {
  cp: PdcaCheckpointDef;
  cycle: PdcaCycleDef;
  templateId: string;
  planPeriodYears: number;
  moduleConfig: Record<string, { enabled: boolean }>;
  readOnly: boolean;
  onClose: () => void;
  onSaved: (updated: PdcaCheckpointDef) => void;
  onDeleted: (cpId: string) => void;
}

function CheckpointEditPanel({
  cp,
  cycle,
  templateId,
  planPeriodYears,
  moduleConfig,
  readOnly,
  onClose,
  onSaved,
  onDeleted,
}: CheckpointEditPanelProps) {
  const [form, setForm] = useState<PdcaCheckpointDef>({ ...cp });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledModules = Object.entries(moduleConfig)
    .filter(([, cfg]) => cfg.enabled)
    .map(([k]) => k);

  const yearOptions = Array.from({ length: planPeriodYears + 1 }, (_, i) => i);

  const update = <K extends keyof PdcaCheckpointDef>(k: K, v: PdcaCheckpointDef[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const toggleTier = (tier: string) => {
    const next = form.evaluation_tiers.includes(tier)
      ? form.evaluation_tiers.filter((t) => t !== tier)
      : [...form.evaluation_tiers, tier];
    update("evaluation_tiers", next);
  };

  const toggleModule = (mod: string) => {
    const next = form.modules_involved.includes(mod)
      ? form.modules_involved.filter((m) => m !== mod)
      : [...form.modules_involved, mod];
    update("modules_involved", next);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/templates/${templateId}/cycles/${cycle.id}/checkpoints/${cp.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            plan_year: form.plan_year,
            month_start: form.month_start,
            month_end: form.month_end,
            evaluation_tiers: form.evaluation_tiers,
            modules_involved: form.modules_involved,
            qc_step: form.qc_step,
            instructions: form.instructions,
            sort_order: form.sort_order,
          }),
        },
      );
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      onSaved(form);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`「${cp.name}」を削除しますか？`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/templates/${templateId}/cycles/${cycle.id}/checkpoints/${cp.id}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok || json.error) {
        setError(json.error ?? "削除に失敗しました");
        return;
      }
      onDeleted(cp.id);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setDeleting(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
  const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border)" };

  const color = getPhaseColor(cycle.phase);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        zIndex: 100,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 4,
              height: 20,
              borderRadius: 2,
              background: color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
            {readOnly ? "チェックポイント詳細" : "チェックポイント編集"}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* フォーム */}
      <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {error && (
          <div
            style={{
              background: "#ef444410",
              border: "1px solid #ef444430",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#f87171",
            }}
          >
            {error}
          </div>
        )}

        {/* 名前 */}
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>
            名前 <span style={{ color: "#f87171" }}>*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            disabled={readOnly}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {/* 説明 */}
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>説明</label>
          <textarea
            value={form.description ?? ""}
            onChange={(e) => update("description", e.target.value || null)}
            disabled={readOnly}
            rows={2}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {/* 年度・月 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>計画年度</label>
            <select
              value={form.plan_year}
              onChange={(e) => update("plan_year", parseInt(e.target.value))}
              disabled={readOnly}
              className={inputClass}
              style={inputStyle}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y} style={{ background: "var(--bg-input)" }}>
                  {y === 0 ? "策定年度" : `${y}年目`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>開始月</label>
            <select
              value={form.month_start}
              onChange={(e) => update("month_start", parseInt(e.target.value))}
              disabled={readOnly}
              className={inputClass}
              style={inputStyle}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m} style={{ background: "var(--bg-input)" }}>{m}月</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>終了月</label>
            <select
              value={form.month_end ?? ""}
              onChange={(e) => update("month_end", e.target.value ? parseInt(e.target.value) : null)}
              disabled={readOnly}
              className={inputClass}
              style={inputStyle}
            >
              <option value="" style={{ background: "var(--bg-input)" }}>なし</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m} style={{ background: "var(--bg-input)" }}>{m}月</option>
              ))}
            </select>
          </div>
        </div>

        {/* 評価層 */}
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>評価層</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {EVALUATION_TIER_OPTIONS.map((opt) => (
              <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 8, cursor: readOnly ? "default" : "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.evaluation_tiers.includes(opt.value)}
                  onChange={() => !readOnly && toggleTier(opt.value)}
                  disabled={readOnly}
                  style={{ accentColor: color }}
                />
                <span style={{ fontSize: 12, color: "#cbd5e1" }}>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 関連モジュール */}
        {enabledModules.length > 0 && (
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>関連モジュール</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {enabledModules.map((mod) => (
                <label key={mod} style={{ display: "flex", alignItems: "center", gap: 8, cursor: readOnly ? "default" : "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.modules_involved.includes(mod)}
                    onChange={() => !readOnly && toggleModule(mod)}
                    disabled={readOnly}
                    style={{ accentColor: color }}
                  />
                  <span style={{ fontSize: 12, color: "#cbd5e1" }}>{mod}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* QCステップ */}
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>QCステップ</label>
          <select
            value={form.qc_step ?? ""}
            onChange={(e) => update("qc_step", e.target.value || null)}
            disabled={readOnly}
            className={inputClass}
            style={inputStyle}
          >
            <option value="" style={{ background: "var(--bg-input)" }}>なし</option>
            {QC_STEP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} style={{ background: "var(--bg-input)" }}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* 備考・手順 */}
        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>備考・手順</label>
          <textarea
            value={form.instructions ?? ""}
            onChange={(e) => update("instructions", e.target.value || null)}
            disabled={readOnly}
            rows={3}
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      {/* フッター */}
      {!readOnly && (
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 8,
          }}
        >
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              background: "linear-gradient(135deg, #6366f1, #06b6d4)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 0",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid #ef444440",
              borderRadius: 8,
              color: "#f87171",
              fontSize: 13,
              fontWeight: 600,
              cursor: deleting ? "not-allowed" : "pointer",
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? "削除中..." : "削除"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── AddCycleDialog ───────────────────────────────────────────────────────────

interface AddCycleDialogProps {
  templateId: string;
  onCreated: (cycle: PdcaCycleDef) => void;
  onClose: () => void;
}

function AddCycleDialog({ templateId, onCreated, onClose }: AddCycleDialogProps) {
  const [form, setForm] = useState({
    name: "",
    cycle_type: "annual",
    phase: "P",
    recurrence: "yearly",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors duration-200";
  const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border)" };

  const handleCreate = async () => {
    if (!form.name.trim()) { setError("サイクル名を入力してください"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/templates/${templateId}/cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "作成に失敗しました");
        return;
      }
      onCreated({
        id: json.data.id,
        template_id: templateId,
        name: form.name,
        cycle_type: form.cycle_type,
        phase: form.phase,
        recurrence: form.recurrence,
        sort_order: 0,
        checkpoints: [],
      });
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 24,
          width: 400,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>
          サイクルを追加
        </h3>

        {error && (
          <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#f87171" }}>
            {error}
          </div>
        )}

        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>サイクル名 *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            className={inputClass}
            style={inputStyle}
            placeholder="例: 年次PDCAサイクル"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>サイクル種別</label>
            <select
              value={form.cycle_type}
              onChange={(e) => setForm((p) => ({ ...p, cycle_type: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            >
              {["annual", "semi_annual", "quarterly", "monthly", "milestone"].map((v) => (
                <option key={v} value={v} style={{ background: "var(--bg-input)" }}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>フェーズ</label>
            <select
              value={form.phase}
              onChange={(e) => setForm((p) => ({ ...p, phase: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            >
              {["P", "D", "C", "A", "P-D", "C-A"].map((v) => (
                <option key={v} value={v} style={{ background: "var(--bg-input)" }}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>繰り返し</label>
          <select
            value={form.recurrence}
            onChange={(e) => setForm((p) => ({ ...p, recurrence: e.target.value }))}
            className={inputClass}
            style={inputStyle}
          >
            {["yearly", "half_yearly", "quarterly", "monthly", "once"].map((v) => (
              <option key={v} value={v} style={{ background: "var(--bg-input)" }}>{v}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "#94a3b8",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            キャンセル
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            style={{
              padding: "8px 20px",
              background: "linear-gradient(135deg, #6366f1, #06b6d4)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "作成中..." : "作成"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CycleLane ────────────────────────────────────────────────────────────────

interface CycleLaneProps {
  cycle: PdcaCycleDef;
  totalCols: number;
  selectedCpId: string | null;
  readOnly: boolean;
  templateId: string;
  onSelectCp: (cp: PdcaCheckpointDef) => void;
  onAddCheckpoint: (cycleId: string) => Promise<PdcaCheckpointDef | null>;
}

function CycleLane({
  cycle,
  totalCols,
  selectedCpId,
  readOnly,
  onSelectCp,
  onAddCheckpoint,
}: CycleLaneProps) {
  const color = getPhaseColor(cycle.phase);
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    await onAddCheckpoint(cycle.id);
    setAdding(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--border)" }}>
      {/* レーンラベル */}
      <div
        style={{
          width: LANE_LABEL_WIDTH,
          flexShrink: 0,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-primary)",
        }}
      >
        <div
          style={{
            width: 28,
            height: 20,
            borderRadius: 4,
            background: color + "20",
            border: `1px solid ${color}60`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color,
            flexShrink: 0,
          }}
        >
          {cycle.phase}
        </div>
        <span
          style={{
            fontSize: 12,
            color: "#cbd5e1",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={cycle.name}
        >
          {cycle.name}
        </span>
      </div>

      {/* タイムライン */}
      <div
        style={{
          flex: 1,
          position: "relative",
          height: 56,
          overflowX: "visible",
        }}
      >
        {/* 月グリッド線 */}
        {Array.from({ length: totalCols }, (_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i * CELL_WIDTH,
              top: 0,
              bottom: 0,
              width: CELL_WIDTH,
            }}
          >
            {!readOnly && (
              <DroppableCell id={`cell:${cycle.id}:${i}`} />
            )}
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 4,
                bottom: 4,
                width: 1,
                background: "var(--border)",
                pointerEvents: "none",
              }}
            />
          </div>
        ))}

        {/* チェックポイントカード */}
        {cycle.checkpoints.map((cp) => (
          <CheckpointCard
            key={cp.id}
            cp={cp}
            cyclePhase={cycle.phase}
            isSelected={selectedCpId === cp.id}
            readOnly={readOnly}
            onClick={() => onSelectCp(cp)}
          />
        ))}

        {/* + チェックポイントを追加ボタン */}
        {!readOnly && (
          <button
            onClick={handleAdd}
            disabled={adding}
            style={{
              position: "absolute",
              right: 4,
              top: "50%",
              transform: "translateY(-50%)",
              background: "#06b6d410",
              border: "1px dashed #06b6d440",
              borderRadius: 6,
              color: "#06b6d4",
              fontSize: 11,
              fontWeight: 600,
              padding: "4px 8px",
              cursor: adding ? "not-allowed" : "pointer",
              opacity: adding ? 0.5 : 1,
              whiteSpace: "nowrap",
              zIndex: 5,
            }}
          >
            {adding ? "追加中..." : "+ チェックポイントを追加"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── CycleDesigner (main) ─────────────────────────────────────────────────────

export default function CycleDesigner({ template, readOnly = false }: CycleDesignerProps) {
  const [cycles, setCycles] = useState<PdcaCycleDef[]>(template.cycles);
  const [selectedCp, setSelectedCp] = useState<{ cp: PdcaCheckpointDef; cycleId: string } | null>(null);
  const [showAddCycle, setShowAddCycle] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const totalYears = template.plan_period_years + 1; // year 0 (策定) + 1〜N
  const totalCols = totalYears * 12;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // チェックポイントを追加
  const handleAddCheckpoint = useCallback(async (cycleId: string): Promise<PdcaCheckpointDef | null> => {
    const cycle = cycles.find((c) => c.id === cycleId);
    if (!cycle) return null;

    const newCp = {
      name: "新しいチェックポイント",
      description: null,
      plan_year: 1,
      month_start: 4,
      month_end: null,
      evaluation_tiers: [] as string[],
      modules_involved: [] as string[],
      qc_step: null,
      instructions: null,
      sort_order: cycle.checkpoints.length,
    };

    try {
      const res = await fetch(
        `/api/admin/templates/${template.id}/cycles/${cycleId}/checkpoints`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newCp),
        },
      );
      const json = (await res.json()) as { data: { id: string } | null; error: string | null };
      if (!res.ok || !json.data) return null;

      const created: PdcaCheckpointDef = { ...newCp, id: json.data.id, cycle_id: cycleId };
      setCycles((prev) =>
        prev.map((c) =>
          c.id === cycleId ? { ...c, checkpoints: [...c.checkpoints, created] } : c,
        ),
      );
      return created;
    } catch {
      return null;
    }
  }, [cycles, template.id]);

  // チェックポイント保存後の状態更新
  const handleSaved = useCallback((updated: PdcaCheckpointDef) => {
    setCycles((prev) =>
      prev.map((c) => ({
        ...c,
        checkpoints: c.checkpoints.map((cp) => (cp.id === updated.id ? updated : cp)),
      })),
    );
    setSelectedCp((prev) => (prev?.cp.id === updated.id ? { ...prev, cp: updated } : prev));
  }, []);

  // チェックポイント削除後の状態更新
  const handleDeleted = useCallback((cpId: string) => {
    setCycles((prev) =>
      prev.map((c) => ({
        ...c,
        checkpoints: c.checkpoints.filter((cp) => cp.id !== cpId),
      })),
    );
    setSelectedCp(null);
  }, []);

  // サイクル作成後の状態更新
  const handleCycleCreated = useCallback((cycle: PdcaCycleDef) => {
    setCycles((prev) => [...prev, cycle]);
    setShowAddCycle(false);
  }, []);

  // DnD
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    // over.id = "cell:${cycleId}:${colIndex}"
    const overId = String(over.id);
    if (!overId.startsWith("cell:")) return;

    const parts = overId.split(":");
    const cycleId = parts[1] ?? "";
    const col = parseInt(parts[2] ?? "0");
    const newPlanYear = Math.floor(col / 12);
    const newMonthStart = (col % 12) + 1;

    const cpId = String(active.id);

    // ローカル更新
    setCycles((prev) =>
      prev.map((c) => ({
        ...c,
        checkpoints: c.checkpoints.map((cp) => {
          if (cp.id !== cpId) return cp;
          return { ...cp, plan_year: newPlanYear, month_start: newMonthStart };
        }),
      })),
    );

    // サイクルIDを特定
    const cycle = cycles.find((c) => c.checkpoints.some((cp) => cp.id === cpId));
    if (!cycle) return;

    // API更新
    await fetch(
      `/api/admin/templates/${template.id}/cycles/${cycleId || cycle.id}/checkpoints/${cpId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_year: newPlanYear, month_start: newMonthStart }),
      },
    );
  }, [cycles, template.id]);

  // ドラッグ中のアクティブカードを表示
  const activeCp = activeDragId
    ? cycles.flatMap((c) => c.checkpoints).find((cp) => cp.id === activeDragId) ?? null
    : null;
  const activeCyclePhase = activeDragId
    ? cycles.find((c) => c.checkpoints.some((cp) => cp.id === activeDragId))?.phase ?? "P"
    : "P";

  // 選択中のサイクル
  const selectedCycle = selectedCp
    ? cycles.find((c) => c.id === selectedCp.cycleId) ?? null
    : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ position: "relative", fontFamily: "inherit" }}>
        {/* ヘッダー: 追加ボタン */}
        {!readOnly && (
          <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowAddCycle(true)}
              style={{
                background: "#6366f110",
                border: "1px solid #6366f140",
                borderRadius: 8,
                color: "#818cf8",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              + サイクルを追加
            </button>
          </div>
        )}

        {/* タイムライングリッド */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
            background: "var(--bg-primary)",
          }}
        >
          {/* ヘッダー行 */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {/* ラベル列ヘッダー */}
            <div
              style={{
                width: LANE_LABEL_WIDTH,
                flexShrink: 0,
                borderRight: "1px solid var(--border)",
                background: "var(--bg-primary)",
              }}
            />
            {/* 月列ヘッダー（スクロールあり） */}
            <div style={{ flex: 1, overflowX: "auto" }}>
              {/* 年度行 */}
              <div style={{ display: "flex", minWidth: totalCols * CELL_WIDTH }}>
                {Array.from({ length: totalYears }, (_, yi) => (
                  <div
                    key={yi}
                    style={{
                      width: 12 * CELL_WIDTH,
                      flexShrink: 0,
                      textAlign: "center",
                      padding: "6px 0",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#94a3b8",
                      borderRight: "1px solid var(--border)",
                      background: yi % 2 === 0 ? "var(--bg-primary)" : "#13151f",
                    }}
                  >
                    {yi === 0 ? "策定年度" : `${yi}年目`}
                  </div>
                ))}
              </div>
              {/* 月番号行 */}
              <div style={{ display: "flex", minWidth: totalCols * CELL_WIDTH, borderTop: "1px solid var(--border)" }}>
                {Array.from({ length: totalCols }, (_, i) => {
                  const month = (i % 12) + 1;
                  return (
                    <div
                      key={i}
                      style={{
                        width: CELL_WIDTH,
                        flexShrink: 0,
                        textAlign: "center",
                        padding: "4px 0",
                        fontSize: 10,
                        color: month === 4 ? "#6366f1" : "#475569",
                        borderRight: "1px solid #1e2130",
                      }}
                    >
                      {month}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* サイクルレーン */}
          <div style={{ overflowX: "auto" }}>
            {cycles.map((cycle) => (
              <CycleLane
                key={cycle.id}
                cycle={cycle}
                totalCols={totalCols}
                selectedCpId={selectedCp?.cp.id ?? null}
                readOnly={readOnly}
                templateId={template.id}
                onSelectCp={(cp) => setSelectedCp({ cp, cycleId: cycle.id })}
                onAddCheckpoint={handleAddCheckpoint}
              />
            ))}

            {cycles.length === 0 && (
              <div
                style={{
                  padding: 32,
                  textAlign: "center",
                  fontSize: 13,
                  color: "#475569",
                }}
              >
                サイクルが登録されていません
                {!readOnly && "。「+ サイクルを追加」から追加してください。"}
              </div>
            )}
          </div>
        </div>

        {/* DragOverlay */}
        <DragOverlay>
          {activeCp && (
            <div
              style={{
                width: cardWidth(activeCp.month_start, activeCp.month_end),
                height: 44,
                background: getPhaseColor(activeCyclePhase) + "30",
                border: `1.5px solid ${getPhaseColor(activeCyclePhase)}`,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                paddingLeft: 8,
                paddingRight: 8,
                opacity: 0.85,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
              }}
            >
              <span style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 500 }}>
                {activeCp.name}
              </span>
            </div>
          )}
        </DragOverlay>
      </div>

      {/* サイドパネル */}
      {selectedCp && selectedCycle && (
        <CheckpointEditPanel
          cp={selectedCp.cp}
          cycle={selectedCycle}
          templateId={template.id}
          planPeriodYears={template.plan_period_years}
          moduleConfig={template.module_config}
          readOnly={readOnly}
          onClose={() => setSelectedCp(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      {/* サイクル追加ダイアログ */}
      {showAddCycle && (
        <AddCycleDialog
          templateId={template.id}
          onCreated={handleCycleCreated}
          onClose={() => setShowAddCycle(false)}
        />
      )}
    </DndContext>
  );
}
