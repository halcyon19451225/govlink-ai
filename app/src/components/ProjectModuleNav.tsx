import Link from "next/link";
import { query } from "@/lib/db";

interface Props {
  projectId: string;
  activeModule?: string;
}

interface ModuleRow {
  id: string;
  display_name: string;
}

const MODULE_PATHS: Record<string, string> = {
  dataset_manager: "datasets",
  gap_analysis: "gap-analysis",
  issue_hypothesis: "issue-hypothesis",
  measure_design: "measure-design",
  logic_model: "logic-model",
  program_evaluation: "program-evaluation",
  cost_efficiency: "cost-efficiency",
  service_volume: "service-volume",
  self_evaluation: "self-evaluation",
};

export default async function ProjectModuleNav({ projectId, activeModule }: Props) {
  let modules: ModuleRow[] = [];
  try {
    modules = await query<ModuleRow>(
      `SELECT pm.id, pm.display_name
       FROM project_module_configs pmc
       JOIN plan_modules pm ON pm.id = pmc.module_id
       WHERE pmc.project_id = $1 AND pmc.is_enabled = true
       ORDER BY pm.sort_order`,
      [projectId],
    );
  } catch {
    return null;
  }

  if (modules.length === 0) return null;

  return (
    <nav className="flex flex-wrap gap-2 mb-4">
      {modules.map((mod) => {
        const path = MODULE_PATHS[mod.id];
        if (!path) return null;
        const isActive = activeModule === mod.id;
        return (
          <Link
            key={mod.id}
            href={`/projects/${projectId}/${path}`}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors duration-200"
            style={
              isActive
                ? {
                    borderColor: "rgba(99,102,241,0.6)",
                    background: "rgba(99,102,241,0.1)",
                    color: "#a5b4fc",
                  }
                : {
                    borderColor: "transparent",
                    color: "#94a3b8",
                  }
            }
          >
            {mod.display_name}
          </Link>
        );
      })}
    </nav>
  );
}
