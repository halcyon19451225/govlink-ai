import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import PermissionMatrix from "./PermissionMatrix";

export const metadata = { title: "権限設定 | GovLink AI" };

export default async function PermissionsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user?.role !== "admin") redirect("/dashboard");

  return <PermissionMatrix />;
}
