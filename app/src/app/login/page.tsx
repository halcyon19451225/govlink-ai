import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginButton from "./LoginButton";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#0f1117" }}
    >
      {/* 背景グロー */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10 blur-3xl"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
        />
      </div>

      <div
        className="relative w-full max-w-sm rounded-2xl border p-10 flex flex-col items-center gap-7 shadow-2xl"
        style={{
          background: "#1a1d27",
          borderColor: "#2a2d3a",
          boxShadow: "0 25px 60px rgba(99,102,241,0.12)",
        }}
      >
        {/* ロゴ */}
        <div className="flex flex-col items-center gap-2">
          <span
            className="text-4xl font-bold tracking-tight bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #6366f1, #06b6d4)",
            }}
          >
            Sinap-sys
          </span>
          <span className="text-sm font-medium text-slate-400 text-center">
            政策の透明性を、すべての人に。
          </span>
        </div>

        <div
          className="w-full border-t"
          style={{ borderColor: "#2a2d3a" }}
        />

        <p className="text-slate-400 text-sm text-center leading-relaxed">
          続けるにはログインが必要です。
          <br />
          Cognito のホスト UI でサインインします。
        </p>

        <LoginButton />

        <p className="text-xs text-slate-500 text-center">
          アカウントをお持ちでない場合は管理者にお問い合わせください。
        </p>
      </div>
    </div>
  );
}
