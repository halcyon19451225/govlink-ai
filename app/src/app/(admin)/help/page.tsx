"use client";

import { useState } from "react";
import Link from "next/link";

const FAQS = [
  {
    q: "データセットのアップロードに失敗する場合は？",
    a: "CSVのカラム名が仕様と一致しているか確認してください。データセット管理画面で必須カラム名を確認できます。また、文字コードは UTF-8 を推奨しています。",
  },
  {
    q: "AI分析に時間がかかる場合は？",
    a: "大量のデータを処理する場合は 30〜60 秒かかることがあります。ページを離れずしばらくお待ちください。タイムアウトが発生した場合はデータ量を減らして再試行してください。",
  },
  {
    q: "PDCAチェックポイントの日程を変更したいです",
    a: "テンプレート編集画面の「PDCAサイクルデザイナー」から各ステージの日程を変更できます。プロジェクト設定 → テンプレート から対象テンプレートを開いてください。",
  },
  {
    q: "パスワードを忘れた場合は？",
    a: "ログイン画面の「パスワードをお忘れの方」から再設定できます。登録済みのメールアドレスに確認コードが送信されます。",
  },
  {
    q: "複数のプロジェクトを管理できますか？",
    a: "はい。ダッシュボードの「＋ 新規政策を登録」から複数のプロジェクトを作成・管理できます。プロジェクトごとに KPI・ロジックモデル・PDCAサイクルを独立して管理できます。",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="glass-card overflow-hidden transition-all duration-200"
      style={{ marginBottom: "0.75rem" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-4"
      >
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {q}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"
          fill="none" stroke="currentColor" strokeWidth="2"
          style={{
            color: "var(--text-secondary)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
          }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="px-5 pb-4 text-sm leading-relaxed border-t"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
        >
          {a}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          使い方マニュアル
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
          よくある質問と回答をまとめています。
        </p>
      </div>

      {/* アコーディオン FAQ */}
      <section className="mb-10">
        <h2 className="text-base font-semibold mb-4" style={{ color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.7rem" }}>
          よくある質問
        </h2>
        {FAQS.map((item) => (
          <FaqItem key={item.q} q={item.q} a={item.a} />
        ))}
      </section>

      {/* お問い合わせリンク */}
      <div
        className="glass-card px-6 py-5 flex items-center justify-between"
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            解決しない場合はお問い合わせください
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            サポートチームが対応いたします
          </p>
        </div>
        <div className="neu-button-wrap">
          <Link
          href="/contact"
          className="text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all duration-200 shrink-0 neu-button-primary"
          style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
        >
          お問い合わせ
        </Link>
        </div>
      </div>
    </div>
  );
}
