import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import OrgTreeManager from "./OrgTreeManager";

export const metadata = { title: "組織管理 | GovLink AI" };

export default async function OrganizationPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user?.role !== "admin") redirect("/dashboard");

  return <OrgTreeManager />;
}
