import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  const providers = {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    line: !!(process.env.LINE_CLIENT_ID && process.env.LINE_CLIENT_SECRET),
    github: !!(process.env.GITHUB_ID && process.env.GITHUB_SECRET),
  };

  return <LoginForm providers={providers} />;
}
