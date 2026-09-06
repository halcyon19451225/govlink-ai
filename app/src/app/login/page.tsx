import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  // ソーシャルログインは Cognito のフェデレーション経由に一本化した（2026-09-06）。
  // LINE は id_token が ES256 のみ、GitHub は OIDC 非対応で Cognito に載せられないため廃止。
  const providers = {
    google: !!(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID),
  };

  return <LoginForm providers={providers} />;
}
