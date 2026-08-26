"use client";

/**
 * 実績報告の回答フォーム（公開・S2 C①）
 * - トークンURLで開く（ログイン不要・1トークン1対象）
 * - 差し戻し（returned）のときは理由を表示して再回答できる
 * - 受領（accepted）後は閲覧のみ
 */

import { useCallback, useEffect, useState } from "react";
import type { ReportQuestion } from "@/lib/report/types";

interface FormData {
  closed: boolean;
  status: "pending" | "answered" | "returned" | "accepted";
  title: string;
  instruction: string | null;
  fiscal_year: number | null;
  due_date: string | null;
  project_title: string;
  municipality: string;
  measure_title: string;
  owner_department: string | null;
  questions: ReportQuestion[];
  answers: Record<string, string | number>;
  reviewed_note: string | null;
}

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
};

export default function ReportFormClient({ token }: { token: string }) {
  const [data, setData] = useState<FormData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/public/report/${token}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const json = (await res.json()) as { data: FormData | null };
      if (res.ok && json.data) {
        setData(json.data);
        const init: Record<string, string> = {};
        for (const [k, v] of Object.entries(json.data.answers ?? {})) init[k] = String(v);
        setValues(init);
      } else {
        setNotFound(true);
      }
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const answers: Record<string, string> = {};
      for (const q of data.questions) {
        const v = (values[q.id] ?? "").trim();
        if (v) answers[q.id] = v;
      }
      const res = await fetch(`/api/public/report/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const json = (await res.json()) as { error: string | null };
      if (!res.ok) {
        setError(json.error ?? "送信に失敗しました");
        return;
      }
      setDone(true);
    } catch {
      setError("通信エラーが発生しました。入力内容はこの画面に残っています — 時間をおいて再送信してください");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Shell><p style={{ color: "#64748b", fontSize: 14 }}>読み込み中…</p></Shell>;
  }
  if (notFound) {
    return (
      <Shell>
        <div style={card} className="p-6">
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>ページが見つかりません</h1>
          <p style={{ fontSize: 14, color: "#475569", marginTop: 8 }}>
            URLが正しいかご確認ください。リンクが失効している場合は、依頼元の担当者にお問い合わせください。
          </p>
        </div>
      </Shell>
    );
  }
  if (!data) return null;

  if (done || data.status === "accepted") {
    return (
      <Shell>
        <div style={card} className="p-6">
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>
            {done ? "✅ 回答を送信しました" : "✅ この回答は受領済みです"}
          </h1>
          <p style={{ fontSize: 14, color: "#475569", marginTop: 8 }}>
            {done
              ? "ご協力ありがとうございました。内容の確認後、修正のお願い（差し戻し）がある場合は同じURLから再回答できます。"
              : "ご協力ありがとうございました。修正が必要な場合は依頼元の担当者にご連絡ください。"}
          </p>
        </div>
      </Shell>
    );
  }
  if (data.closed) {
    return (
      <Shell>
        <div style={card} className="p-6">
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>受付を終了しました</h1>
          <p style={{ fontSize: 14, color: "#475569", marginTop: 8 }}>
            この実績報告の受付は終了しています。お問い合わせは依頼元の担当者までお願いします。
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={card} className="p-6" >
        <p style={{ fontSize: 12, color: "#64748b" }}>{data.municipality} / {data.project_title}</p>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>{data.title}</h1>
        <p style={{ fontSize: 13, color: "#475569", marginTop: 6 }}>
          対象の取組: <b>{data.measure_title || "全体"}</b>
          {data.owner_department && `（${data.owner_department}）`}
          {data.due_date && ` ／ 回答期限: ${data.due_date}`}
        </p>
        {data.instruction && (
          <p style={{ fontSize: 13, color: "#334155", marginTop: 10, whiteSpace: "pre-wrap", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
            {data.instruction}
          </p>
        )}
        {data.status === "returned" && data.reviewed_note && (
          <div style={{ marginTop: 10, background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: 12 }}>
            <p style={{ fontSize: 13, color: "#92400e" }}>
              🔁 修正のお願い（差し戻し）: {data.reviewed_note}
            </p>
          </div>
        )}
        {data.status === "answered" && (
          <p style={{ fontSize: 12, color: "#0891b2", marginTop: 8 }}>
            回答済みです。受領されるまでは、このまま修正して再送信できます。
          </p>
        )}
      </div>

      <div style={card} className="p-6">
        {error && (
          <div style={{ marginBottom: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10 }}>
            <p style={{ fontSize: 13, color: "#b91c1c" }}>⚠️ {error}</p>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data.questions.map((q) => (
            <div key={q.id}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", display: "block" }}>
                {q.label}
                {q.unit && <span style={{ fontWeight: 400, color: "#64748b" }}>（{q.unit}）</span>}
                {q.required && <span style={{ color: "#dc2626" }}> *</span>}
              </label>
              {q.type === "textarea" ? (
                <textarea
                  value={values[q.id] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  rows={4}
                  style={{ marginTop: 4, width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: "#0f172a" }}
                />
              ) : (
                <input
                  type={q.type === "number" ? "number" : "text"}
                  inputMode={q.type === "number" ? "decimal" : undefined}
                  step={q.type === "number" ? "any" : undefined}
                  value={values[q.id] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  style={{ marginTop: 4, width: "100%", maxWidth: q.type === "number" ? 220 : undefined, border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: "#0f172a" }}
                />
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => void submit()}
          disabled={busy}
          style={{
            marginTop: 20,
            background: "linear-gradient(135deg, #6366f1, #06b6d4)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            border: "none",
            borderRadius: 10,
            padding: "10px 24px",
            cursor: "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "送信中…" : data.status === "returned" ? "修正して再送信する" : "回答を送信する"}
        </button>
        <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 10 }}>
          実績値は台帳等の記録に基づいてご記入ください。送信後も受領されるまでは同じURLから修正できます。
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "32px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
        <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>Coe 実績報告フォーム</p>
      </div>
    </div>
  );
}
