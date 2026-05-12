import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import MemberManager from "./MemberManager";

export const metadata = { title: "メンバー管理 | GovLink AI" };

export default async function MembersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user?.role !== "admin") redirect("/dashboard");

  return <MemberManager />;
}
