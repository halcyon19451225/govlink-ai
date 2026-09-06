import ProjectSidebar from "@/components/ProjectSidebar";
import AutoHelpButton from "@/components/help/AutoHelpButton";
import { assertProjectPage } from "@/lib/tenant-page";

interface Props {
  children: React.ReactNode;
  params: { id: string };
}

export default async function ProjectLayout({ children, params }: Props) {
  // テナント境界の保険。**これだけでは足りない**（App Router は layout と page を
  // 並行して描画するため、ここで notFound() を投げても page の本体は走りうる）。
  // 実際の境界は各 page 先頭の assertProjectPage。
  // claude/coe-tenant-isolation.md A-3
  await assertProjectPage(params.id);

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      <ProjectSidebar projectId={params.id} />
      <main style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
        {children}
      </main>
      {/* M3: URLから現在メニューを判定してヘルプを自動設置（右下） */}
      <AutoHelpButton />
    </div>
  );
}
