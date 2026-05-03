import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#0f1117" }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-10 flex flex-col items-center gap-6 text-center"
        style={{
          background: "#1a1d27",
          borderColor: "#2a2d3a",
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}
      >
        <span
          className="text-6xl font-bold bg-clip-text text-transparent"
          style={{ backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          404
        </span>
        <div>
          <h2 className="text-xl font-bold text-slate-100 mb-2">ページが見つかりません</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            お探しのページは存在しないか、移動した可能性があります。
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-all duration-200 shadow-lg shadow-indigo-500/20"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        >
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
