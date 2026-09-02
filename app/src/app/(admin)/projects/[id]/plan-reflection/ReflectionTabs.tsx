"use client";

/**
 * 収束工程のタブ（G1 対応表・G4 諮問事項整理書＋H4 理由書・G2 反映状況報告書・H3 未反映事項台帳）。
 * 判定・処遇は評価の保存値を写すだけ。手で起こす欄だけをここで編集し、plan_reflections（061）へ書く。
 */

import { useState } from "react";
import { fiscalYearLabel } from "@/lib/measure/indicators";
import {
  ADOPTION_LABEL,
  DEFERRED_REASON_LABEL,
  DEFERRED_STATUS_LABEL,
  REFLECT_KIND_LABEL,
  type Adoption,
  type DeferredItem,
  type DeferredReasonKind,
  type DeferredStatus,
  type ReflectKind,
  type ReflectionData,
  type ReportRow,
} from "@/lib/evaluation/reflectionData";

const card: React.CSSProperties = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const box: React.CSSProperties = { borderColor: "var(--border)", background: "var(--bg-primary)" };
const inputCls = "w-full text-xs rounded-md px-2 py-1.5 border text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500";
const inputSty: React.CSSProperties = { background: "var(--bg-input)", borderColor: "var(--border)" };
const btnPrimary: React.CSSProperties = { background: "#6366f1", color: "#fff" };

export interface TabProps {
  projectId: string;
  data: ReflectionData;
  reload: () => Promise<void>;
  download: (path: string, fallback: string) => Promise<void>;
  busy: boolean;
  setError: (e: string | null) => void;
}

async function patchReflection(projectId: string, evaluationId: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`/api/admin/projects/${projectId}/plan-reflection/${evaluationId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => null)) as { error?: string } | null;
  return res.ok ? null : (j?.error ?? "保存に失敗しました");
}

function ReportBadge({ r }: { r: ReportRow }) {
  return (
    <span className="text-[11px]">
      <span className="font-mono text-slate-200">{r.path}</span>
      <span className="text-slate-500"> → </span>
      {r.report_no ? (
        <span style={{ color: "#818cf8" }}>No.{r.report_no} {r.report_title}</span>
      ) : (
        <span style={{ color: "#fbbf24" }}>{r.report_title}</span>
      )}
      {!r.frozen && <span className="ml-1 text-[10px]" style={{ color: "#fbbf24" }}>【暫定】</span>}
    </span>
  );
}

// ─── G1 評価・計画対応表 ──────────────────────────────────

function G1Row({ r, projectId, data, reload, setError }: { r: ReportRow } & TabProps) {
  const [open, setOpen] = useState(false);
  const f = r.reflection;
  const [decided, setDecided] = useState(r.decided_treatment ?? "");
  const [stage, setStage] = useState<"draft" | "council" | "reply">("council");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<ReflectKind | "">(f.reflect_kind ?? "");
  const [nextId, setNextId] = useState(f.reflect_measure_id ?? "");
  const [loc, setLoc] = useState(f.reflect_location ?? "");
  const [notAdopted, setNotAdopted] = useState(f.reflect_reason ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    const err = await patchReflection(projectId, r.evaluation_id, body);
    setSaving(false);
    setError(err);
    if (!err) await reload();
  };

  return (
    <>
      <tr className="border-t align-top" style={{ borderColor: "var(--border)" }}>
        <td className="px-2 py-1.5 text-slate-300">{r.report_no ? `No.${r.report_no}` : "—"}<span className="block text-[10px] text-slate-500">{r.report_title}</span></td>
        <td className="px-2 py-1.5 text-slate-200">{r.measure_title}<span className="block text-[10px] text-slate-500">{r.owner_department ?? ""}</span></td>
        <td className="px-2 py-1.5"><ReportBadge r={r} /></td>
        <td className="px-2 py-1.5 text-slate-300">{r.route ? `${r.route} ${r.route_name}` : r.exemption ? "除外" : r.report_no == null ? "保留" : "—"}</td>
        <td className="px-2 py-1.5 text-slate-300">{r.standard_treatment ?? "—（処遇を行わない）"}</td>
        <td className="px-2 py-1.5 text-slate-200">
          {r.decided_treatment ?? <span className="text-slate-600">—</span>}
          {f.decision_history.filter((h) => h.stage !== "draft").map((h, i) => (
            <span key={i} className="block text-[10px] text-slate-500">{h.at.slice(0, 10)} {h.stage === "reply" ? "答申" : "会議"}: {h.decided_treatment}{h.reason ? `（${h.reason}）` : ""}</span>
          ))}
        </td>
        <td className="px-2 py-1.5">{r.rationale_required ? <span style={{ color: r.rationale ? "#fbbf24" : "#f87171" }} title={r.rationale ?? "未記入"}>○{r.rationale ? "" : " 未記入"}</span> : <span className="text-slate-600">—</span>}</td>
        <td className="px-2 py-1.5 text-slate-300">
          {f.reflect_kind === "not_adopted"
            ? <span>不採用: <span className="text-slate-400">{f.reflect_reason}</span></span>
            : f.reflect_kind
              ? [f.reflect_measure_id ? data.next_measures.find((m) => m.id === f.reflect_measure_id)?.title : null, f.reflect_location].filter(Boolean).join("／") || <span className="text-slate-600">（未記入）</span>
              : <span className="text-slate-600">（未記入）</span>}
        </td>
        <td className="px-2 py-1.5">
          <span style={{ color: r.reconciled ? "#34d399" : r.report_no == null ? "#94a3b8" : "#fbbf24" }}>{r.reconciled ? "対応済み" : "未対応"}</span>
          <span className="block text-[10px] text-slate-500">{r.reconcile_note}</span>
        </td>
        <td className="px-2 py-1.5">
          <button type="button" onClick={() => setOpen(!open)} className="text-[11px] text-indigo-400">{open ? "閉じる ▲" : "記入 ▼"}</button>
        </td>
      </tr>
      {open && (
        <tr style={{ background: "var(--bg-primary)" }}>
          <td colSpan={10} className="px-3 py-3">
            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="rounded-lg border p-3 space-y-2" style={box}>
                <p className="text-[11px] font-semibold text-slate-300">G1-6 決定処遇（処遇決定会議→答申）</p>
                <p className="text-[10px] text-slate-500">標準処遇: {r.standard_treatment ?? "—"}。答申により事務局案を修正した場合は、修正内容と理由をここに残します（履歴に追記）。</p>
                <input className={inputCls} style={inputSty} value={decided} placeholder="決定処遇" onChange={(e) => setDecided(e.target.value)} />
                <div className="flex gap-2">
                  <select className={inputCls} style={{ ...inputSty, width: 160 }} value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
                    <option value="council">処遇決定会議</option>
                    <option value="reply">答申による修正</option>
                    <option value="draft">事務局案の修正</option>
                  </select>
                  <input className={inputCls} style={inputSty} value={reason} placeholder="修正の理由（答申の要旨など）" onChange={(e) => setReason(e.target.value)} />
                </div>
                <button type="button" disabled={saving} className="text-[11px] px-3 py-1 rounded-md font-semibold disabled:opacity-50" style={btnPrimary}
                  onClick={() => void save({ decided_treatment: decided || null, decision_stage: stage, decision_reason: reason || null })}>
                  決定処遇を記録
                </button>
                {r.rationale_required && !r.rationale && (
                  <p className="text-[10px]" style={{ color: "#f87171" }}>標準処遇と異なるため理由書（H4）が必須です。G4タブの「H4 理由書」で記入してください。</p>
                )}
              </div>
              <div className="rounded-lg border p-3 space-y-2" style={box}>
                <p className="text-[11px] font-semibold text-slate-300">G1-8 次期計画の反映箇所（骨子確定後に記入）</p>
                <select className={inputCls} style={inputSty} value={kind} onChange={(e) => setKind(e.target.value as ReflectKind | "")}>
                  <option value="">（未記入）</option>
                  {(Object.keys(REFLECT_KIND_LABEL) as ReflectKind[]).map((k) => <option key={k} value={k}>{REFLECT_KIND_LABEL[k]}</option>)}
                </select>
                {kind === "measure" && (
                  data.next_measures.length > 0 ? (
                    <select className={inputCls} style={inputSty} value={nextId} onChange={(e) => setNextId(e.target.value)}>
                      <option value="">次期施策を選ぶ（{data.next_project?.title}）</option>
                      {data.next_measures.map((m) => <option key={m.id} value={m.id}>{m.title}{m.cloned_from_measure_id === r.measure_id ? "（この施策のクローン）" : ""}</option>)}
                    </select>
                  ) : (
                    <p className="text-[10px] text-slate-500">次期計画（クローン）が未作成のため、施策No.・章・頁を下に記入します。クローン作成後にリンクできます。</p>
                  )
                )}
                {kind !== "not_adopted" && kind !== "" && (
                  <input className={inputCls} style={inputSty} value={loc} placeholder="施策No.・章・頁（例: 第4章 施策3-2 p.42）" onChange={(e) => setLoc(e.target.value)} />
                )}
                {kind === "not_adopted" && (
                  <textarea className={inputCls} style={inputSty} rows={2} value={notAdopted} placeholder="不採用の理由（必須。行き先として有効にするため）" onChange={(e) => setNotAdopted(e.target.value)} />
                )}
                <button type="button" disabled={saving} className="text-[11px] px-3 py-1 rounded-md font-semibold disabled:opacity-50" style={btnPrimary}
                  onClick={() => void save({ reflect_kind: kind || null, reflect_measure_id: kind === "measure" && nextId ? nextId : null, reflect_location: kind === "not_adopted" ? null : loc || null, reflect_reason: kind === "not_adopted" ? notAdopted : null })}>
                  反映箇所を保存
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function G1Tab(p: TabProps) {
  const { data, download, busy } = p;
  const rc = data.reconciliation;
  return (
    <section className="rounded-2xl border" style={card}>
      <header className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold text-slate-200">様式G1 評価・計画対応表</h3>
        <span className="text-[11px] text-slate-500">報告書 {data.reports.length}件（判定あり {rc.total}）</span>
        <button type="button" disabled={busy} onClick={() => void download("g1", "様式G1.docx")} className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50" style={btnPrimary}>
          {busy ? "作成中…" : "📄 G1をWordで出力"}
        </button>
      </header>
      <div className="p-4 space-y-3">
        <div className="rounded-lg border px-3 py-2 text-[11px] flex flex-wrap gap-x-5 gap-y-1" style={{ borderColor: rc.unreconciled > 0 || rc.unsourced > 0 ? "#f59e0b60" : "#10b98160", background: rc.unreconciled > 0 || rc.unsourced > 0 ? "#f59e0b0d" : "#10b9810d" }}>
          <span className="font-semibold" style={{ color: rc.unreconciled > 0 || rc.unsourced > 0 ? "#fbbf24" : "#34d399" }}>
            照合（停止条件・現在は警告）: {rc.unreconciled === 0 && rc.unsourced === 0 ? "対応漏れなし" : "対応漏れあり — 計画案を決裁に回せません"}
          </span>
          <span className="text-slate-400">順方向: 行き先のない報告書 {rc.unreconciled}／{rc.total}</span>
          <span className="text-slate-400">逆方向: 根拠のない次期施策 {data.next_project ? `${rc.unsourced}／${data.next_measures.length}` : "（次期計画が未作成）"}</span>
          <span className="text-slate-400">理由書 {rc.exceptions}件{rc.total > 0 && rc.exceptions > rc.total / 2 ? "（過半 — 決定ルールの改定を検討）" : ""}</span>
        </div>
        {data.unsourced_next_measures.length > 0 && (
          <p className="text-[11px]" style={{ color: "#fbbf24" }}>根拠のない次期施策: {data.unsourced_next_measures.map((m) => m.title).join("、")}</p>
        )}
        {data.reports.length === 0 ? (
          <p className="text-xs text-slate-500">主要施策評価がまだありません。C評価 → 主要施策評価（計画期間）で判定すると、ここに報告書が並びます。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-[11px]" style={{ minWidth: 1200 }}>
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left px-2 py-1 font-medium">報告書No.</th>
                  <th className="text-left px-2 py-1 font-medium">施策（前期）</th>
                  <th className="text-left px-2 py-1 font-medium">判定</th>
                  <th className="text-left px-2 py-1 font-medium">ルート</th>
                  <th className="text-left px-2 py-1 font-medium">標準処遇</th>
                  <th className="text-left px-2 py-1 font-medium">決定処遇</th>
                  <th className="text-left px-2 py-1 font-medium">理由書</th>
                  <th className="text-left px-2 py-1 font-medium">反映箇所</th>
                  <th className="text-left px-2 py-1 font-medium">照合</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>{data.reports.map((r) => <G1Row key={r.evaluation_id} r={r} {...p} />)}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── G4 諮問事項整理書（＋H4 理由書）───────────────────────

function G4Form({ r, projectId, reload, setError, download, busy }: { r: ReportRow } & TabProps) {
  const f = r.reflection;
  const [form, setForm] = useState({
    inquiry_no: f.inquiry_no ?? "",
    inquiry_date: f.inquiry_date ?? "",
    reply_due: f.reply_due ?? "",
    a: f.opinions.a ?? "", b: f.opinions.b ?? "", c: f.opinions.c ?? "", d: f.opinions.d ?? "",
    stakeholder: f.stakeholder_opinions ?? "",
    delta: f.resource_change.delta_amount != null ? String(f.resource_change.delta_amount) : "",
    released: f.resource_change.released_amount != null ? String(f.resource_change.released_amount) : "",
    realloc: f.resource_change.reallocation_to ?? "",
    neutral: f.resource_change.budget_neutral == null ? "" : f.resource_change.budget_neutral ? "yes" : "no",
    rc_note: f.resource_change.note ?? "",
    reply_result: f.reply_result ?? "",
    reply_date: f.reply_date ?? "",
    rationale: r.rationale ?? "",
    decided_on: f.decided_on ?? "",
    meeting: f.decision_meeting ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const save = async () => {
    setSaving(true);
    const err = await patchReflection(projectId, r.evaluation_id, {
      inquiry_no: form.inquiry_no || null,
      inquiry_date: form.inquiry_date || null,
      reply_due: form.reply_due || null,
      opinions: { a: form.a, b: form.b, c: form.c, d: form.d },
      stakeholder_opinions: form.stakeholder || null,
      resource_change: { delta_amount: num(form.delta), released_amount: num(form.released), reallocation_to: form.realloc || null, budget_neutral: form.neutral === "" ? null : form.neutral === "yes", note: form.rc_note || null },
      reply_result: form.reply_result || null,
      reply_date: form.reply_date || null,
      rationale: form.rationale || null,
      decided_on: form.decided_on || null,
      decision_meeting: form.meeting || null,
    });
    setSaving(false);
    setError(err);
    if (!err) await reload();
  };

  // コンポーネントではなく関数（内側で定義したコンポーネントは入力のたびに再マウントして
  // フォーカスが外れるため）
  const field = (label: string, k: keyof typeof form, rows?: number) => (
    <label key={k} className="block text-[10px] text-slate-500">
      {label}
      {rows ? (
        <textarea className={inputCls} style={inputSty} rows={rows} value={form[k]} onChange={(e) => set(k, e.target.value)} />
      ) : (
        <input className={inputCls} style={inputSty} value={form[k]} onChange={(e) => set(k, e.target.value)} />
      )}
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 text-[11px] space-y-1" style={box}>
        <p className="text-slate-300 font-semibold">①〜⑦（共通ヘッダから自動）</p>
        <p className="text-slate-400">② 対象: <span className="text-slate-200">{r.measure_title}</span>{r.owner_department && `／${r.owner_department}`}</p>
        <p className="text-slate-400">③ 評価結果: <ReportBadge r={r} />／比較の段 {r.comparison_grade ?? "未入力"}／{(r.evaluated_at ?? "").slice(0, 10)}{r.fiscal_year != null && `（${fiscalYearLabel(r.fiscal_year)}）`}</p>
        {r.outcome && <p className="text-slate-400">④ 成果: {r.outcome.label} 基準値 {r.outcome.baseline}／目標 {r.outcome.target}／実績 {r.outcome.result}／ベースライン {r.outcome.natural_baseline}／X {r.outcome.x}</p>}
        <p className="text-slate-400">⑤ 費用と効率性: 事業費 {r.cost_total != null ? `¥${r.cost_total.toLocaleString()}` : "—"}／寄与経路 {r.pathways}／効果率 {r.fiscal_rate != null ? `${r.fiscal_rate}%（${r.fiscal_mark}）` : "算定不能（保留）"}</p>
        <p className="text-slate-400">⑥ 標準処遇: <span className="text-slate-200">{r.standard_treatment ?? "—（処遇を行わない）"}</span></p>
        <p className="text-slate-400">⑦ 事務局案: <span className="text-slate-200">{r.decided_treatment ?? "（未決定 — G1タブで記録）"}</span>{r.rationale_required && <span style={{ color: "#fbbf24" }}>（標準処遇と異なる → 理由書H4を兼ねる）</span>}</p>
        <p className="text-slate-400">⑩ 諮問事項（{r.route ? `ルート${r.route} ${r.route_name}・${r.review}` : "報告のみ"}）: <span className="text-slate-200">{r.inquiry_items.join("／") || "測定設計のみ"}</span></p>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="rounded-lg border p-3 space-y-2" style={box}>
          <p className="text-[11px] font-semibold text-slate-300">① 諮問の基本事項</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            {field("諮問番号", "inquiry_no")}
            <label className="block text-[10px] text-slate-500">諮問年月日<input type="date" className={inputCls} style={inputSty} value={form.inquiry_date} onChange={(e) => set("inquiry_date", e.target.value)} /></label>
            <label className="block text-[10px] text-slate-500">答申を要する期日<input type="date" className={inputCls} style={inputSty} value={form.reply_due} onChange={(e) => set("reply_due", e.target.value)} /></label>
          </div>
          <p className="text-[11px] font-semibold text-slate-300 pt-1">⑧ 判断4軸の所見（各1〜2文・事実→評価の順）</p>
          {field("ア 評価との整合性（達成でも寄与不明なら継続理由を再確認）", "a", 2)}
          {field("イ 見直しによる改善可能性（対象絞り込み・頻度変更・連携強化の余地）", "b", 2)}
          {field("ウ 対象・目的・手段の明確さ（誰に・何のために・何を・どの程度）", "c", 2)}
          {field("エ 実務妥当性（現場で回るか・関係資源と接続できるか・住民に説明できるか）", "d", 2)}
          <p className="text-[11px] font-semibold text-slate-300 pt-1">⑨ 関係機関の意見</p>
          {field("聴取した意見と、事務局案への反映状況（反映しなかった意見はその理由を明記）", "stakeholder", 3)}
        </div>
        <div className="rounded-lg border p-3 space-y-2" style={box}>
          <p className="text-[11px] font-semibold text-slate-300">H4 理由書（標準処遇と異なる場合に必須）{r.rationale_required && !form.rationale && <span style={{ color: "#f87171" }}> — 未記入</span>}</p>
          {field("理由（①数字上はこう見えるが〜という事実・事情がある ②現場・関係機関も〜という意見 ③制度・上位計画との整合 → よって〔決定処遇〕とする）", "rationale", 5)}
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label className="block text-[10px] text-slate-500">処遇決定会議の決定日<input type="date" className={inputCls} style={inputSty} value={form.decided_on} onChange={(e) => set("decided_on", e.target.value)} /></label>
            {field("会議名", "meeting")}
          </div>
          <p className="text-[11px] font-semibold text-slate-300 pt-1">⑪ 資源の異動（千円）</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {field("増減額", "delta")}
            {field("解放資源の額", "released")}
            {field("再配分先候補", "realloc")}
            <label className="block text-[10px] text-slate-500">予算中立の確認
              <select className={inputCls} style={inputSty} value={form.neutral} onChange={(e) => set("neutral", e.target.value)}>
                <option value="">未確認</option><option value="yes">確認済み（中立）</option><option value="no">中立でない</option>
              </select>
            </label>
          </div>
          {field("備考", "rc_note")}
          <p className="text-[11px] font-semibold text-slate-300 pt-1">答申（段階2-4）</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 2fr" }}>
            <label className="block text-[10px] text-slate-500">答申日<input type="date" className={inputCls} style={inputSty} value={form.reply_date} onChange={(e) => set("reply_date", e.target.value)} /></label>
            {field("答申結果（事務局案を修正した場合はG1-6にも記録）", "reply_result")}
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" disabled={busy} onClick={() => void download(`g4/${r.evaluation_id}`, "様式G4.docx")} className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50" style={{ background: "var(--bg-input)", color: "#94a3b8", border: "1px solid var(--border)" }}>
          📄 G4をWordで出力
        </button>
        <button type="button" disabled={saving} onClick={() => void save()} className="text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50" style={btnPrimary}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

export function G4Tab(p: TabProps) {
  const { data } = p;
  const [sel, setSel] = useState<string>(data.reports[0]?.evaluation_id ?? "");
  const r = data.reports.find((x) => x.evaluation_id === sel);
  return (
    <section className="rounded-2xl border" style={card}>
      <header className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold text-slate-200">様式G4 諮問事項整理書（＋H4 理由書）</h3>
        <span className="text-[11px] text-slate-500">報告書1件につき1葉。①〜⑦は自動生成、担当者が起こすのは⑧〜⑫と理由書だけ</span>
      </header>
      <div className="p-4 grid gap-4" style={{ gridTemplateColumns: "260px 1fr" }}>
        <div className="space-y-1">
          {data.reports.length === 0 && <p className="text-xs text-slate-500">報告書がまだありません。</p>}
          {data.reports.map((x) => (
            <button key={x.evaluation_id} type="button" onClick={() => setSel(x.evaluation_id)} className="w-full text-left rounded-lg px-3 py-2 text-[11px]"
              style={{ background: sel === x.evaluation_id ? "#6366f118" : "var(--bg-primary)", border: `1px solid ${sel === x.evaluation_id ? "#6366f1" : "var(--border)"}` }}>
              <span className="text-slate-200 block">{x.measure_title}</span>
              <ReportBadge r={x} />
              <span className="block text-[10px] text-slate-500">{x.review ?? ""}{x.rationale_required ? `／理由書${x.rationale ? "あり" : "未記入"}` : ""}</span>
            </button>
          ))}
        </div>
        <div>{r ? <G4Form key={r.evaluation_id} r={r} {...p} /> : <p className="text-xs text-slate-500">左の報告書を選んでください。</p>}</div>
      </div>
    </section>
  );
}

// ─── G2 反映状況報告書 ────────────────────────────────────

export function G2Tab(p: TabProps) {
  const { data, projectId, reload, setError, download, busy } = p;
  const rows = data.reports.filter((r) => r.report_no != null || r.exemption);
  const exceptions = rows.filter((r) => r.adoption_effective && r.adoption_effective !== "adopted").length;
  const setAdoption = async (r: ReportRow, v: Adoption | "") => {
    const err = await patchReflection(projectId, r.evaluation_id, { adoption: v || null });
    setError(err);
    if (!err) await reload();
  };
  return (
    <section className="rounded-2xl border" style={card}>
      <header className="px-4 py-2.5 border-b flex items-center gap-3 flex-wrap" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold text-slate-200">様式G2 反映状況報告書</h3>
        <span className="text-[11px] text-slate-500">{rows.length}件／例外（一部採用・不採用）{exceptions}件{rows.length > 0 && exceptions > rows.length / 2 ? " — 過半。決定ルールの改定を検討" : ""}</span>
        <button type="button" disabled={busy} onClick={() => void download("g2", "様式G2.docx")} className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50" style={btnPrimary}>
          {busy ? "作成中…" : "📄 G2をWordで出力"}
        </button>
      </header>
      <div className="p-4 space-y-2">
        <p className="text-[11px] text-slate-500">「決定」は標準処遇に対する採否（決定処遇そのものではない）。既定は 標準どおり＝採用／異なる＝一部採用。不採用は担当者が選ぶ。理由は理由書（H4）の要旨を転記。計画と併せて公表。</p>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500">判定のある報告書がまだありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-[11px]" style={{ minWidth: 1000 }}>
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left px-2 py-1 font-medium">報告書No.（施策）</th>
                  <th className="text-left px-2 py-1 font-medium">評価結果の要旨</th>
                  <th className="text-left px-2 py-1 font-medium">標準処遇</th>
                  <th className="text-left px-2 py-1 font-medium">決定</th>
                  <th className="text-left px-2 py-1 font-medium">不採用・変更の理由</th>
                  <th className="text-left px-2 py-1 font-medium">反映箇所</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.evaluation_id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                    <td className="px-2 py-1.5"><span className="text-slate-200">{r.report_no ? `No.${r.report_no}` : "除外"}</span> <span className="text-slate-400">{r.measure_title}</span></td>
                    <td className="px-2 py-1.5 text-slate-300">{r.state}（{r.path}）{r.outcome && <span className="block text-slate-500">{r.outcome.label}: {r.outcome.baseline}→{r.outcome.result}（目標 {r.outcome.target}）</span>}</td>
                    <td className="px-2 py-1.5 text-slate-300">{r.standard_treatment ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <select className={inputCls} style={{ ...inputSty, width: 120 }} value={r.reflection.adoption ?? ""} onChange={(e) => void setAdoption(r, e.target.value as Adoption | "")}>
                        <option value="">既定（{r.adoption_effective ? ADOPTION_LABEL[r.adoption_effective] : "未決定"}）</option>
                        {(Object.keys(ADOPTION_LABEL) as Adoption[]).map((k) => <option key={k} value={k}>{ADOPTION_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-slate-400">{r.adoption_effective && r.adoption_effective !== "adopted" ? (r.rationale ?? <span style={{ color: "#f87171" }}>（理由書未記入）</span>) : "－"}</td>
                    <td className="px-2 py-1.5 text-slate-300">{r.reflection.reflect_kind === "not_adopted" ? `不採用: ${r.reflection.reflect_reason}` : [r.reflection.reflect_measure_id ? data.next_measures.find((m) => m.id === r.reflection.reflect_measure_id)?.title : null, r.reflection.reflect_location].filter(Boolean).join("／") || <span className="text-slate-600">（未記入）</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── H3 未反映事項台帳 ────────────────────────────────────

export function H3Tab(p: TabProps) {
  const { data, projectId, reload, setError } = p;
  const [form, setForm] = useState({ title: "", detail: "", source_ref: "", reason_kind: "other" as DeferredReasonKind, reason: "", review_due: "", condition: "", evaluation_id: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  const add = async () => {
    if (!form.title.trim()) { setError("事項を記入してください"); return; }
    setSaving(true);
    const res = await fetch(`/api/admin/projects/${projectId}/plan-reflection/deferred`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, detail: form.detail || null, source_ref: form.source_ref || null, reason: form.reason || null, review_due: form.review_due || null, condition: form.condition || null, evaluation_id: form.evaluation_id || null }),
    });
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    setSaving(false);
    setError(res.ok ? null : (j?.error ?? "登録に失敗しました"));
    if (res.ok) { setForm({ ...form, title: "", detail: "", source_ref: "", reason: "", condition: "" }); await reload(); }
  };
  const move = async (item: DeferredItem, status: DeferredStatus) => {
    const note = status === "dropped" ? window.prompt("取り下げの理由（必須）") : null;
    if (status === "dropped" && !note) return;
    const res = await fetch(`/api/admin/projects/${projectId}/plan-reflection/deferred/${item.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(note ? { status_note: note } : {}), ...(status === "re_proposed" ? { re_proposed_fiscal_year: new Date().getMonth() + 1 >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1 } : {}) }),
    });
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(res.ok ? null : (j?.error ?? "更新に失敗しました"));
    if (res.ok) await reload();
  };
  const NEXT: Record<DeferredStatus, DeferredStatus[]> = { deferred: ["re_proposed", "dropped"], re_proposed: ["adopted", "deferred", "dropped"], adopted: [], dropped: ["deferred"] };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-2xl border" style={card}>
      <header className="px-4 py-2.5 border-b flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold text-slate-200">様式H3 未反映事項台帳</h3>
        <span className="text-[11px] text-slate-500">見送り {data.deferred.filter((d) => d.status === "deferred").length}件（年次評価で必ず再上程。「見送り」を「消滅」にしない）</span>
      </header>
      <div className="p-4 space-y-3">
        <div className="rounded-lg border p-3 grid gap-2" style={{ ...box, gridTemplateColumns: "2fr 1fr 1fr" }}>
          <input className={inputCls} style={inputSty} placeholder="事項（見送った知見・施策案）" value={form.title} onChange={(e) => set("title", e.target.value)} />
          <input className={inputCls} style={inputSty} placeholder="出典（報告書No.・G3知見ID）" value={form.source_ref} onChange={(e) => set("source_ref", e.target.value)} />
          <select className={inputCls} style={inputSty} value={form.evaluation_id} onChange={(e) => set("evaluation_id", e.target.value)}>
            <option value="">出典の報告書（任意）</option>
            {data.reports.map((r) => <option key={r.evaluation_id} value={r.evaluation_id}>{r.measure_title}{r.report_no ? ` No.${r.report_no}` : ""}</option>)}
          </select>
          <input className={inputCls} style={inputSty} placeholder="内容" value={form.detail} onChange={(e) => set("detail", e.target.value)} />
          <select className={inputCls} style={inputSty} value={form.reason_kind} onChange={(e) => set("reason_kind", e.target.value)}>
            {(Object.keys(DEFERRED_REASON_LABEL) as DeferredReasonKind[]).map((k) => <option key={k} value={k}>{DEFERRED_REASON_LABEL[k]}</option>)}
          </select>
          <input className={inputCls} style={inputSty} placeholder="見送りの理由" value={form.reason} onChange={(e) => set("reason", e.target.value)} />
          <input className={inputCls} style={inputSty} placeholder="再上程の条件（例: 参入候補事業者の確保）" value={form.condition} onChange={(e) => set("condition", e.target.value)} />
          <label className="text-[10px] text-slate-500">再検討期日（年次評価の時期）<input type="date" className={inputCls} style={inputSty} value={form.review_due} onChange={(e) => set("review_due", e.target.value)} /></label>
          <button type="button" disabled={saving} onClick={() => void add()} className="text-xs font-semibold px-3 py-1.5 rounded-lg self-end disabled:opacity-50" style={btnPrimary}>＋ 台帳に登録</button>
        </div>
        {data.deferred.length === 0 ? (
          <p className="text-xs text-slate-500">未反映事項はありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-[11px]" style={{ minWidth: 900 }}>
              <thead>
                <tr className="text-slate-500">
                  <th className="text-left px-2 py-1 font-medium">事項</th>
                  <th className="text-left px-2 py-1 font-medium">見送りの理由</th>
                  <th className="text-left px-2 py-1 font-medium">再検討期日</th>
                  <th className="text-left px-2 py-1 font-medium">再上程の条件</th>
                  <th className="text-left px-2 py-1 font-medium">状態</th>
                  <th className="text-left px-2 py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.deferred.map((d) => {
                  const overdue = d.status === "deferred" && d.review_due && d.review_due <= today;
                  return (
                    <tr key={d.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                      <td className="px-2 py-1.5 text-slate-200">{d.title}{d.source_ref && <span className="block text-[10px] text-slate-500">出典: {d.source_ref}</span>}{d.detail && <span className="block text-slate-400">{d.detail}</span>}</td>
                      <td className="px-2 py-1.5 text-slate-300">{DEFERRED_REASON_LABEL[d.reason_kind]}{d.reason && <span className="block text-slate-500">{d.reason}</span>}</td>
                      <td className="px-2 py-1.5" style={{ color: overdue ? "#f87171" : "#cbd5e1" }}>{d.review_due ?? "—"}{overdue && <span className="block text-[10px]">期日到来 — 再上程を</span>}</td>
                      <td className="px-2 py-1.5 text-slate-300">{d.condition ?? "—"}</td>
                      <td className="px-2 py-1.5 text-slate-300">{DEFERRED_STATUS_LABEL[d.status]}{d.re_proposed_fiscal_year != null && `（${fiscalYearLabel(d.re_proposed_fiscal_year)}）`}{d.status_note && <span className="block text-[10px] text-slate-500">{d.status_note}</span>}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {NEXT[d.status].map((s) => (
                          <button key={s} type="button" onClick={() => void move(d, s)} className="text-[10px] text-indigo-400 mr-2">{DEFERRED_STATUS_LABEL[s]}へ</button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
