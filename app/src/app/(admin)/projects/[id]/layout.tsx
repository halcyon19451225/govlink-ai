import ProjectSidebar from "@/components/ProjectSidebar";

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
    </div>
  );
}
