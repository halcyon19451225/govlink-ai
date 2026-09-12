"use client";

import { useEffect, useState, useCallback } from "react";

type Plan = "free" | "light" | "standard" | "premium";

type Status = {
  linked: boolean;
  codeMasked: string | null;
  orgName: string | null;
  linkedAt: string | null;
  /** 実際に適用されているプラン（未連携・照会失敗なら null） */
  plan: Plan | null;
  /** 紐づけが実際にプランとして効いているか */
  applied: boolean;
};

const PLAN_LABEL: Record<Plan, string> = {
  free: "無料",
  light: "ライト",
  standard: "スタンダード",
  premium: "プレミアム",
};

/**
 * 組織コード連携セクション（プラン・請求画面／契約案内画面）。
 * Ordo で発行された組織コード（ORG-XXXX-XXXX / COEM-XXXX-XXXX）を入力すると、
 * 組織契約（請求書払い等）のプランがこの自治体に適用される。
 *
 * `continueHref` を渡すと、プランが有効になった時点で次へ進むボタンを出す。
 * 契約案内画面（/subscribe-required）から使うときに指定する。
 * 指定しないと「紐づけました」と出るだけで、利用者は自分で画面を再読み込み
 * しなければ先に進めない。
 */
export default function OrgCodeSection({ continueHref }: { continueHref?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/org-code");
      const json = (await res.json()) as { data: Status | null };
      if (json.data) {
        setStatus(json.data);
        if (json.data.applied) setReady(true);
      }
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
      const json = (await res.json()) as {
        data: { orgName: string | null; plan: Plan } | null;
        error: string | null;
      };
      if (json.error) {
        setMsg(json.error);
      } else {
        const plan = json.data?.plan ?? "free";
        const org = json.data?.orgName ?? code;
        if (plan === "free") {
          // 契約自体は有効だが Coe の有料プランに対応していない、という状態。
          // ボタンを出すと押しても弾き返されるので出さない
          setMsg(`「${org}」に紐づけましたが、この契約には Coe の有料プランが含まれていません。Ordo までお問い合わせください。`);
        } else {
          setMsg(`「${org}」の契約に紐づけました。${PLAN_LABEL[plan]}プランが利用できます。`);
          setReady(true);
        }
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
      setReady(false);
      await load();
    } catch {
      setMsg("通信エラーが発生しました");
    }
    setBusy(false);
  };

  // 紐づいてはいるが、プランとして効いていない状態。
  // ここを黙って「紐づいています」とだけ表示すると、利用者も運営も原因に辿り着けない
  const linkedButNotApplied = !!status?.linked && !status.applied;

  const inputBlock = (
    <div className="flex gap-2 flex-wrap">
      <input
        value={code}
        maxLength={20}
        placeholder="例: ORG-XXXX-XXXX"
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && code.trim() && !busy) void link();
        }}
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
  );

  return (
    <section className="mb-8">
      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">組織コード連携</h3>
      <div
        className="rounded-2xl border p-6"
        style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
      >
        {status?.linked ? (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-200">
                  {status.orgName ?? "組織契約"} に紐づいています
                  {status.applied && status.plan ? `（${PLAN_LABEL[status.plan]}プラン）` : ""}
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

            {linkedButNotApplied && (
              <div
                className="mt-4 rounded-xl border p-4"
                style={{ borderColor: "rgba(245, 158, 11, 0.4)", background: "rgba(245, 158, 11, 0.08)" }}
              >
                <p className="text-sm font-semibold" style={{ color: "#fbbf24" }}>
                  この連携は現在プランに反映されていません
                </p>
                <p className="text-xs text-slate-400 mt-1 mb-3 leading-relaxed">
                  契約が終了しているか、連携情報が古くなっている可能性があります。
                  お手元の組織コードを入力し直すと、最新の契約で紐づけ直せます。
                </p>
                {inputBlock}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-3">
              組織契約（請求書払い等）をお持ちの場合は、組織の担当者から配布された組織コード（ORG-XXXX-XXXX）を入力すると契約プランが適用されます。
            </p>
            {inputBlock}
          </>
        )}

        {msg && <p className="text-xs text-slate-400 mt-3">{msg}</p>}

        {continueHref && ready && (
          <a
            href={continueHref}
            className="inline-block mt-4 text-sm font-semibold text-white px-5 py-2.5 rounded-xl transition-all duration-200 hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}
          >
            Coe を使い始める →
          </a>
        )}
      </div>
    </section>
  );
}
