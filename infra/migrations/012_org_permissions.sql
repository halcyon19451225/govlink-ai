-- ================================================================
-- Migration 012: 組織・権限管理システム
-- ================================================================

-- ================================================================
-- 組織ユニット（無制限階層・マテリアライズドパス）
-- ================================================================
CREATE TABLE IF NOT EXISTS org_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id UUID REFERENCES municipalities(id) ON DELETE CASCADE,
  -- NULL = システム全体共通（中央省庁等）
  name TEXT NOT NULL,
  parent_id UUID REFERENCES org_units(id) ON DELETE CASCADE,
  org_type TEXT NOT NULL DEFAULT 'department'
    CHECK (org_type IN (
      'ministry', 'prefecture', 'municipality',
      'bureau', 'division', 'department', 'section', 'team', 'custom'
    )),
  path TEXT NOT NULL DEFAULT '/',
  depth INT NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON org_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_municipality ON org_units(municipality_id);

-- ================================================================
-- 役職（組織ユニット内での役割）
-- ================================================================
CREATE TABLE IF NOT EXISTS org_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_unit_id UUID NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rank INT NOT NULL DEFAULT 100,
  can_manage_below BOOLEAN NOT NULL DEFAULT false,
  is_default_role BOOLEAN DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_roles_unit ON org_roles(org_unit_id);

-- ================================================================
-- ユーザーの組織役職メンバーシップ
-- ================================================================
CREATE TABLE IF NOT EXISTS user_org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  -- user_roles.id を参照
  org_role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,
  granted_by UUID,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(user_id, org_role_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON user_org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_role ON user_org_memberships(org_role_id);

-- ================================================================
-- 役職ごとのプロジェクト権限
-- ================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission_level') THEN
    CREATE TYPE permission_level AS ENUM ('none','view','edit','approve','admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS role_project_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  project_access permission_level NOT NULL DEFAULT 'none',
  module_permissions JSONB NOT NULL DEFAULT '{}',
  granted_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_role_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_role_proj_perms_role ON role_project_permissions(org_role_id);
CREATE INDEX IF NOT EXISTS idx_role_proj_perms_project ON role_project_permissions(project_id);

-- ================================================================
-- 権限委譲ログ（監査証跡）
-- ================================================================
CREATE TABLE IF NOT EXISTS permission_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  target_user_id UUID,
  target_role_id UUID,
  project_id UUID,
  module_id TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- デフォルトデータ
-- ================================================================

-- ルート組織（システム全体）
INSERT INTO org_units (id, name, org_type, path, depth)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Coeシステム管理',
  'ministry',
  '/00000000-0000-0000-0000-000000000001',
  0
)
ON CONFLICT (id) DO NOTHING;

-- システム管理者ロール
INSERT INTO org_roles (org_unit_id, name, rank, can_manage_below)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'システム管理者', 1, true),
  ('00000000-0000-0000-0000-000000000001', '一般ユーザー', 999, false)
ON CONFLICT DO NOTHING;
