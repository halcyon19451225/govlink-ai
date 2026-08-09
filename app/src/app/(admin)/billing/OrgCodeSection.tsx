"use client";

import { useEffect, useState, useCallback } from "react";

type Status = {
  linked: boolean;
  codeMasked: string | null;
  orgName: string | null;
  linkedAt: string | null;
};

/**
 * 組織コード連携セクション（プラン・請求画面）。
 * Ordo で発行された組織コード（COE-XXXX-XXXX）を入力すると、
 * 組織契約（請求書払い等）のプランがこの自治体に適用される。
 */
export default function OrgCodeSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/org-code");
      const json = (await res.json()) as { data: Status | null };
      if (json.data) setStatus(json.data);
    } catch {
      /* 非表示のまま */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const link = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/org-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = (await res.json()) as { data: { orgName: string | null } | null; error: string | null };
      if (json.error) {
        setMsg(json.error);
      } else {
        setMsg(`「${json.data?.orgName ?? code}」の契約に紐づけました。プランに反映されます。`);
        setCode("");
        await load();
      }
    } catch {
      setMsg("通信エラーが発生しました");
    }
    setBusy(false);
  };

  const unlink = async () => {
    if (!confirm("組織コードの紐づけを解除しますか？組織契約のプランが適用されなくなります。")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/org-code", { method: "DELETE" });
      const json = (await res.json()) as { error: string | null };
      setMsg(json.error ?? "紐づけを解除しました。");
      await load();
    } catch {
      setMsg("通信エラーが発生しました");
    }
    setBusy(false);
  };

  return (
    <section className="mb-8">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">組織コード連携</h3>
      <div
        className="rounded-2xl border p-6"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        {status?.linked ? (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-200">
                {status.orgName ?? "組織契約"} に紐づいています
              </p>
              <p className="text-xs text-slate-500 mt-1">
                コード: {status.codeMasked}
                {status.linkedAt ? ` ・ 連携日: ${status.linkedAt.slice(0, 10)}` : ""}
              </p>
            </div>
            <button
              onClick={unlink}
              disabled={busy}
              className="text-xs px-3 py-2 rounded-lg border transition-colors duration-200 hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              解除
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-3">
              組織契約（請求書払い等）をお持ちの場合は、担当者に配布された組織コードを入力すると契約プランが適用されます。
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                value={code}
                maxLength={20}
                placeholder="例: COE-XXXX-XXXX"
                onChange={(e) => setCode(e.target.value)}
                className="rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 transition-colors duration-200"
                style={{ background: "var(--bg-input)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
              <button
                onClick={link}
                disabled={busy || !code.trim()}
                className="text-sm font-semibold text-white px-5 py-2.5 rounded-xl transition-all duration-200 disabled:opacity-50 hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
              >
                {busy ? "確認中…" : "紐づける"}
              </button>
            </div>
          </>
        )}
        {msg && <p className="text-xs text-slate-400 mt-3">{msg}</p>}
      </div>
    </section>
  );
}
