import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  // ソーシャルログインは 2026-09-12 に全廃した（Ordo 側 claude/ordo-id-unify.md）。
  // ログイン手段は Ordo ID（メールアドレス＋パスワード）のみ。
  return <LoginForm />;
}
