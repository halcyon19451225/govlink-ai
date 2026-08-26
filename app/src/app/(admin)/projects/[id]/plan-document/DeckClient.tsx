"use client";

/**
 * 受益者向け説明資料 — PL4 P④（「🎤 説明資料」タブ）
 *
 * 流れ:
 *   1. 対象を選ぶ … 「全体概要」（6枚）または「取組別」（施策を複数選択・表紙＋4枚/取組）
 *   2. 「スライドを起こす」… 実データからAIが下書き生成
 *      （スライド本文=箇条書き / **読み原稿=ノート欄**: 話し言葉・1枚45〜60秒）
 *   3. スライドごとに編集・🔒ロック・AIリライト → 保存 → 確定
 *   4. pptx をダウンロード（PowerPoint のノート欄に読み原稿が入る —
 *      Libera の pptx→ナレーション動画エンジンの入力形式と一致）
 */

import { useCallback, useEffect, useState } from "react";
import type { PlanSection } from "@/lib/plan/document";
import { MEASURE_SLIDE_KINDS, OVERVIEW_SLIDES } from "@/lib/plan/deck";

interface DocInfo {
  id: string;
  title: string;
  status: "draft" | "finalized";
  sections: PlanSection[];
  generated_at: string | null;
  finalized_at: string | null;
  updated_at: string | null;
}

interface ExportRow {
  id: string;
  variant: string;
  file_name: string;
  file_size_bytes: number | null;
  created_at: string;
}

interface MeasureRow {
  id: string;
  title: string;
}

const card: React.CSSProperties = {
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
};

const fmtSize = (n: number | null): string =>
  n == null ? "—" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;

/** スライドIDから「このスライドの狙い」を引く（全体概要=固定ID / 取組別=m:<uuid>:<種別>） */
function briefOf(id: string): string | null {
  const fixed = OVERVIEW_SLIDES.find((s) => s.id === id);
  if (fixed) return fixed.brief;
  const m = id.match(/^m:[0-9a-f-]{36}:(\w+)$/);
  if (m) return MEASURE_SLIDE_KINDS.find((k) => k.suffix === m[1])?.brief ?? null;
  return null;
}

export default function DeckClient({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const [doc, setDoc] = useState<DocInfo | null>(null);
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [measures, setMeasures] = useState<MeasureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<"overview" | "measures">("overview");
  const [selectedMeasures, setSelectedMeasures] = useState<Set<string>>(new Set());

  const finalized = doc?.status === "finalized";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document?doc=deck`);
      const json = (await res.json()) as {
        data: { doc: DocInfo | null; exports: ExportRow[]; measures: MeasureRow[] | null } | null;
        error: string | null;
      };
      if (res.ok && json.data) {
        setDoc(json.data.doc);
        setExports(json.data.exports);
        setMeasures(json.data.measures ?? []);
        setDirty(false);
      } else {
        setError(json.error ?? "読み込みに失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleMeasure = (id: string) => {
    setSelectedMeasures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── 生成 ─────────────────────────────────────
  const generate = async () => {
    if (target === "measures" && selectedMeasures.size === 0) {
      setError("取組別を選んだ場合は、対象の取組を1つ以上選択してください");
      return;
    }
    if (
      doc &&
      !window.confirm(
        "スライドを起こし直します。🔒ロック済みのスライドは守られますが、対象（全体概要/取組の選択）を変えた場合は構成が入れ替わります。続けますか？",
      )
    )
      return;
    setBusy("generate");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc: "deck",
          target,
          measure_ids: target === "measures" ? Array.from(selectedMeasures) : [],
        }),
      });
      const json = (await res.json()) as { data: { generated: number } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "生成に失敗しました");
        return;
      }
      setNotice(`スライドの下書きを生成しました（${json.data.generated}枚）。本文と読み原稿を確認してください`);
      await load();
    } catch {
      setError("通信エラーが発生しました（生成には1〜2分かかることがあります）");
    } finally {
      setBusy(null);
    }
  };

  // ── 保存 ─────────────────────────────────────
  const save = async () => {
    if (!doc) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: "deck", title: doc.title, sections: doc.sections }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "保存に失敗しました");
        return;
      }
      setNotice("保存しました");
      setDirty(false);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ── 確定 / 解除 ───────────────────────────────
  const setFinalize = async (finalize: boolean) => {
    if (finalize && dirty) {
      setError("未保存の編集があります。先に保存してください");
      return;
    }
    if (finalize && !window.confirm("説明資料を確定します。確定中は編集・生成・リライトができません（解除は可能）。よろしいですか？")) return;
    setBusy("finalize");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: "deck", finalize }),
      });
      const json = (await res.json()) as { data: unknown; error: string | null };
      if (!res.ok) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      setNotice(finalize ? "説明資料を確定しました" : "確定を解除しました（編集できます）");
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const updateSection = (id: string, patch: Partial<PlanSection>) => {
    setDoc((prev) =>
      prev
        ? { ...prev, sections: prev.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
        : prev,
    );
    setDirty(true);
  };

  // ── リライト ─────────────────────────────────
  const rewrite = async (sectionId: string) => {
    const instruction = (rewriteInstruction[sectionId] ?? "").trim();
    if (!instruction) {
      setError("リライトの指示を入力してください（例: 高齢者向けにもっとゆっくりした原稿に / 箇条書きを3つに絞って）");
      return;
    }
    if (dirty) {
      setError("未保存の編集があります。リライトの前に保存してください");
      return;
    }
    setBusy(`rewrite:${sectionId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: "deck", section_id: sectionId, instruction }),
      });
      const json = (await res.json()) as { data: { sections: PlanSection[] } | null; error: string | null };
      if (!res.ok || !json.data) {
        setError(json.error ?? "リライトに失敗しました");
        return;
      }
      setDoc((prev) => (prev ? { ...prev, sections: json.data!.sections } : prev));
      setRewriteInstruction((prev) => ({ ...prev, [sectionId]: "" }));
      setNotice("スライドを書き直しました（本文と読み原稿を確認してください）");
      setDirty(false);
    } catch {
      setError("通信エラーが発生しました（リライトには時間がかかることがあります）");
    } finally {
      setBusy(null);
    }
  };

  // ── pptx出力 ─────────────────────────────────
  const download = async () => {
    if (dirty) {
      setError("未保存の編集があります。出力の前に保存してください");
      return;
    }
    setBusy("export");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: "deck" }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "出力に失敗しました");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''(.+)$/);
      const fileName = m ? decodeURIComponent(m[1]!) : `${projectTitle}.pptx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`${fileName} をダウンロードしました（PowerPointのノート欄に読み原稿が入っています）`);
      await load();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  const redownload = async (exp: ExportRow) => {
    setBusy(`redownload:${exp.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/admin/projects/${projectId}/plan-document/exports/${exp.id}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "ファイルの取得に失敗しました");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exp.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(null);
    }
  };

  // ── 表示 ─────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-2xl p-6 text-sm" style={card}>
        読み込み中…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" }}>
          ⚠️ {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" }}>
          ✅ {notice}
        </div>
      )}

      {/* ── 対象の選択と生成 ── */}
      <div className="rounded-2xl p-4" style={card}>
        <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          🎤 説明資料の対象
        </h2>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          住民説明会向けのスライドを実データから生成します。各スライドのノート欄に読み原稿
          （話し言葉・1枚45〜60秒目安）が入ります。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm" style={{ color: "var(--text-primary)" }}>
          <label className="flex items-center gap-1">
            <input type="radio" checked={target === "overview"} onChange={() => setTarget("overview")} disabled={finalized} />
            全体概要（6枚: 表紙・なぜ・目指す姿・取組一覧・スケジュール・問い合わせ）
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={target === "measures"} onChange={() => setTarget("measures")} disabled={finalized} />
            取組別（表紙＋選んだ取組ごとに4枚）
          </label>
        </div>
        {target === "measures" && (
          <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            {measures.length === 0 && <span>（施策が未登録です — 施策構築で作成してください）</span>}
            {measures.map((m) => (
              <label key={m.id} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={selectedMeasures.has(m.id)}
                  onChange={() => toggleMeasure(m.id)}
                  disabled={finalized}
                />
                {m.title}
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void generate()}
            disabled={busy != null || finalized}
            className="neu-button px-4 py-2 text-sm font-semibold"
            style={{ color: "#6366f1", opacity: busy != null || finalized ? 0.5 : 1 }}
          >
            {busy === "generate" ? "生成中…（1〜2分）" : doc ? "🪄 スライドを起こし直す" : "🪄 スライドを起こす"}
          </button>
          {doc && (
            <>
              <button
                onClick={() => void save()}
                disabled={busy != null || finalized || !dirty}
                className="neu-button px-4 py-2 text-sm font-semibold"
                style={{ color: dirty ? "#0891b2" : "var(--text-secondary)", opacity: busy != null || finalized || !dirty ? 0.5 : 1 }}
              >
                {busy === "save" ? "保存中…" : dirty ? "💾 保存（未保存の編集あり）" : "💾 保存済み"}
              </button>
              {finalized ? (
                <button onClick={() => void setFinalize(false)} disabled={busy != null} className="neu-button px-4 py-2 text-sm font-semibold" style={{ color: "#b45309" }}>
                  🔓 確定を解除
                </button>
              ) : (
                <button onClick={() => void setFinalize(true)} disabled={busy != null} className="neu-button px-4 py-2 text-sm font-semibold" style={{ color: "#0f6e56", opacity: busy != null ? 0.5 : 1 }}>
                  ✅ 確定する
                </button>
              )}
            </>
          )}
        </div>
        {doc && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span>
              状態:{" "}
              {finalized ? (
                <b style={{ color: "#0f6e56" }}>確定済み（{doc.finalized_at?.slice(0, 10)}）</b>
              ) : (
                <b style={{ color: "#b45309" }}>下書き</b>
              )}
            </span>
            {doc.generated_at && <span>最終生成: {doc.generated_at.slice(0, 16).replace("T", " ")}</span>}
            <span>スライド {doc.sections.length} 枚</span>
          </div>
        )}
      </div>

      {/* ── タイトル ── */}
      {doc && (
        <div className="rounded-2xl p-4" style={card}>
          <label className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            資料の標題（表紙・ファイル名に使用）
          </label>
          <input
            value={doc.title}
            onChange={(e) => {
              setDoc((prev) => (prev ? { ...prev, title: e.target.value } : prev));
              setDirty(true);
            }}
            disabled={finalized}
            className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            maxLength={200}
          />
        </div>
      )}

      {/* ── スライド ── */}
      {doc &&
        doc.sections.map((s, i) => {
          const open = openId === s.id;
          const brief = briefOf(s.id);
          return (
            <div key={s.id} className="rounded-2xl" style={card}>
              <button
                onClick={() => setOpenId(open ? null : s.id)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left"
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {i + 1}枚目 {s.heading}
                </span>
                {s.locked && (
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#fef3c7", color: "#92400e" }}>
                    🔒 ロック中
                  </span>
                )}
                {!s.summary.trim() && s.body_md.trim() && (
                  <span className="text-xs" style={{ color: "#b45309" }}>
                    （読み原稿なし）
                  </span>
                )}
                <span className="ml-auto text-xs" style={{ color: "var(--text-secondary)" }}>
                  {open ? "▲ 閉じる" : "▼ 開く"}
                </span>
              </button>
              {open && (
                <div className="px-4 pb-4 space-y-3">
                  {brief && (
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      このスライドの狙い: {brief}
                    </p>
                  )}
                  <div>
                    <label className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                      スライド本文（「- 」の箇条書き・6項目以内目安）
                    </label>
                    <textarea
                      value={s.body_md}
                      onChange={(e) => updateSection(s.id, { body_md: e.target.value })}
                      disabled={finalized}
                      rows={6}
                      placeholder="- 箇条書き1&#10;- 箇条書き2"
                      className="mt-1 w-full rounded-xl px-3 py-2 text-sm font-mono"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                      🎤 読み原稿（ノート欄に入ります。話し言葉・45〜60秒 ≒ 250〜350字）
                    </label>
                    <textarea
                      value={s.summary}
                      onChange={(e) => updateSection(s.id, { summary: e.target.value })}
                      disabled={finalized}
                      rows={5}
                      className="mt-1 w-full rounded-xl px-3 py-2 text-sm"
                      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                    />
                    {s.summary.trim() && (
                      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {s.summary.length}字（目安: 250〜350字 / 45〜60秒）
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={s.locked}
                        onChange={(e) => updateSection(s.id, { locked: e.target.checked })}
                        disabled={finalized}
                      />
                      🔒 このスライドをロック（生成・リライトで上書きしない）
                    </label>
                  </div>
                  {!finalized && !s.locked && s.body_md.trim() && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={rewriteInstruction[s.id] ?? ""}
                        onChange={(e) => setRewriteInstruction((prev) => ({ ...prev, [s.id]: e.target.value }))}
                        placeholder="リライトの指示（例: 高齢者向けにゆっくりした原稿に / 箇条書きを3つに）"
                        className="flex-1 min-w-[240px] rounded-xl px-3 py-2 text-sm"
                        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                        maxLength={2000}
                      />
                      <button
                        onClick={() => void rewrite(s.id)}
                        disabled={busy != null}
                        className="neu-button px-3 py-2 text-sm font-semibold"
                        style={{ color: "#6366f1", opacity: busy != null ? 0.5 : 1 }}
                      >
                        {busy === `rewrite:${s.id}` ? "書き直し中…" : "🪄 AIリライト"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

      {/* ── pptx出力 ── */}
      {doc && (
        <div className="rounded-2xl p-4" style={card}>
          <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            📥 pptx出力
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            各スライドのノート欄に読み原稿が入ります（発表者ビュー・ナレーション動画化の入力に使えます）。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void download()}
              disabled={busy != null}
              className="neu-button px-4 py-2 text-sm font-semibold"
              style={{ color: "#0891b2", opacity: busy != null ? 0.5 : 1 }}
            >
              {busy === "export" ? "出力中…" : "🎤 説明資料をダウンロード（pptx）"}
            </button>
          </div>
          {exports.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                出力履歴（再ダウンロード可能）
              </h3>
              <div className="mt-2 space-y-1">
                {exports.map((exp) => (
                  <div key={exp.id} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span>{exp.created_at.slice(0, 16).replace("T", " ")}</span>
                    <span className="truncate" style={{ color: "var(--text-primary)" }}>
                      {exp.file_name}
                    </span>
                    <span>{fmtSize(exp.file_size_bytes)}</span>
                    <button
                      onClick={() => void redownload(exp)}
                      disabled={busy != null}
                      className="neu-button px-2 py-1"
                      style={{ color: "#0891b2" }}
                    >
                      {busy === `redownload:${exp.id}` ? "取得中…" : "⬇ 再取得"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
