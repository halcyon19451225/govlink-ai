"use client";

import { signIn } from "next-auth/react";

export default function LoginButton() {
  return (
    <button
      id="login-button"
      onClick={() => signIn("cognito", { callbackUrl: "/dashboard" })}
      className="w-full py-3 px-6 text-white font-semibold rounded-xl transition-all duration-200 hover:opacity-90 active:opacity-80 text-sm shadow-lg shadow-indigo-500/20"
      style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)" }}
    >
      ログイン
    </button>
  );
}
