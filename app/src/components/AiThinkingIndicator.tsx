"use client";

import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/ai/turnClient";

/**
 * AI思考中インジケータ（対話型モジュール共通）
 *
 * 視覚弱者にも分かりやすいよう、高コントラストの波形バー + テキストラベルで構成。
 * prefers-reduced-motion 環境ではアニメーションを停止し静的表示にする。
 *
 * 経過時間を出すのは、待っている人が「止まった」と誤解して再試行するのを防ぐため。
 * 再試行は turn_token を差し替えるので、走っているターンの結果が捨てられる
 * （2026-09-01、実測 41〜159秒のターンを3分で見限って再試行し、
 *   AIは毎回正常に応答しているのに画面には何も出ない状態が続いた）。
 */
export default function AiThinkingIndicator({
  label,
  sub,
}: {
  label: string;
  sub?: string;
}) {
  // このコンポーネントは処理中だけ描画されるので、マウントからの経過を数えれば足りる
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsedMs(Date.now() - started), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl px-4 py-3"
      style={{
        background: "linear-gradient(135deg, rgba(99,102,241,0.14), rgba(20,184,166,0.14))",
        border: "1px solid rgba(129,140,248,0.45)",
      }}
    >
      <style>{`
        .coe-think-bars { display: flex; align-items: flex-end; gap: 3px; height: 26px; }
        .coe-think-bar {
          width: 5px; height: 100%; border-radius: 99px;
          background: linear-gradient(180deg, #a5b4fc, #2dd4bf);
          transform-origin: bottom;
          animation: coeThinkWave 1.1s ease-in-out infinite;
        }
        .coe-think-bar:nth-child(1) { animation-delay: 0s; }
        .coe-think-bar:nth-child(2) { animation-delay: 0.15s; }
        .coe-think-bar:nth-child(3) { animation-delay: 0.3s; }
        .coe-think-bar:nth-child(4) { animation-delay: 0.45s; }
        .coe-think-bar:nth-child(5) { animation-delay: 0.6s; }
        @keyframes coeThinkWave {
          0%, 100% { transform: scaleY(0.25); opacity: 0.6; }
          50% { transform: scaleY(1); opacity: 1; }
        }
        .coe-think-dots::after {
          content: "…";
          display: inline-block;
          animation: coeThinkDots 1.5s steps(4, end) infinite;
        }
        @keyframes coeThinkDots {
          0% { clip-path: inset(0 100% 0 0); }
          40% { clip-path: inset(0 60% 0 0); }
          70% { clip-path: inset(0 30% 0 0); }
          100% { clip-path: inset(0 0 0 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .coe-think-bar { animation: none; }
          .coe-think-bar:nth-child(odd) { transform: scaleY(0.9); }
          .coe-think-bar:nth-child(even) { transform: scaleY(0.5); }
          .coe-think-dots::after { animation: none; clip-path: none; }
        }
      `}</style>
      <div className="coe-think-bars" aria-hidden="true">
        <span className="coe-think-bar" />
        <span className="coe-think-bar" />
        <span className="coe-think-bar" />
        <span className="coe-think-bar" />
        <span className="coe-think-bar" />
      </div>
      <div>
        <p className="coe-think-dots text-sm font-semibold" style={{ color: "#c7d2fe" }}>
          {label}
        </p>
        {sub && (
          <p className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>
            {sub}
          </p>
        )}
        {/* 20秒を超えたら経過を出す。長いターンは2〜3分かかることがある */}
        {elapsedMs >= 20_000 && (
          <p className="text-[11px] mt-0.5" style={{ color: "#94a3b8" }}>
            経過 {formatElapsed(elapsedMs)}
            {elapsedMs >= 90_000 && "（長い工程では3分ほどかかることがあります。そのままお待ちください）"}
          </p>
        )}
      </div>
    </div>
  );
}
