import ProjectSidebar from "@/components/ProjectSidebar";
import AutoHelpButton from "@/components/help/AutoHelpButton";

interface Props {
  children: React.ReactNode;
  params: { id: string };
}

export default function ProjectLayout({ children, params }: Props) {
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
