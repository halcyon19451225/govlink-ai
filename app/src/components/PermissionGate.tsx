"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { PERMISSION_ORDER, type PermissionLevel, type ModuleId } from "@/lib/permission-types";

const LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: "アクセス",
  view: "閲覧",
  edit: "編集",
  approve: "承認",
  admin: "管理者",
};

interface Props {
  module?: ModuleId;
  level: PermissionLevel;
  projectId?: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function PermissionGate({ module, level, projectId, children, fallback }: Props) {
  const { data: session } = useSession();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) return;

    // System admins bypass all checks
    if (session.user?.role === "admin") {
      setAllowed(true);
      return;
    }

    const params = new URLSearchParams();
    if (module) params.set("moduleId", module);
    if (projectId) params.set("projectId", projectId);

    fetch(`/api/admin/permissions/check?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { effectiveLevel?: PermissionLevel }) => {
        const effective = d.effectiveLevel ?? "none";
        setAllowed(PERMISSION_ORDER[effective] >= PERMISSION_ORDER[level]);
      })
      .catch(() => setAllowed(false));
  }, [session, module, projectId, level]);

  // Optimistic: show children while permission is being resolved
  if (allowed === null) return <>{children}</>;
  if (allowed) return <>{children}</>;

  // Explicit fallback
  if (fallback !== undefined) return <>{fallback}</>;

  // Default: blur + lock overlay
  return (
    <div className="relative inline-block">
      <div style={{ filter: "blur(2px)", pointerEvents: "none", userSelect: "none" }}>
        {children}
      </div>
      <div
        className="absolute inset-0 flex items-center justify-center gap-1 rounded"
        style={{ background: "rgba(0,0,0,0.25)", cursor: "not-allowed" }}
        title={`この操作には${LEVEL_LABELS[level]}権限が必要です`}
      >
        <span style={{ fontSize: 14 }}>🔒</span>
        <span style={{ fontSize: 11, color: "#e2e8f0", whiteSpace: "nowrap" }}>
          {LEVEL_LABELS[level]}権限が必要
        </span>
      </div>
    </div>
  );
}
