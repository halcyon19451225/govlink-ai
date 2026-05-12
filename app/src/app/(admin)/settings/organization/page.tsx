import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isOrgAdmin } from "@/lib/permissions";
import OrgTreeManager from "./OrgTreeManager";

export const metadata = { title: "組織管理 | GovLink AI" };

export default async function OrganizationPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const userRoleId = session.user?.userRoleId;
  const isAdmin =
    session.user?.role === "admin" ||
    (userRoleId ? await isOrgAdmin(userRoleId) : false);

  if (!isAdmin) redirect("/dashboard");

  return <OrgTreeManager />;
}
