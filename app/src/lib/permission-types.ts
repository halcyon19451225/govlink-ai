// クライアント・サーバー両方で使える型定義と定数のみ（DBアクセスなし）

export type PermissionLevel = "none" | "view" | "edit" | "approve" | "admin";

export type ModuleId =
  | "dataset_manager"
  | "gap_analysis"
  | "issue_hypothesis"
  | "logic_model"
  | "program_evaluation"
  | "cost_efficiency"
  | "service_volume"
  | "self_evaluation";

export const PERMISSION_ORDER: Record<PermissionLevel, number> = {
  none: 0,
  view: 1,
  edit: 2,
  approve: 3,
  admin: 4,
};
