-- ================================================================
-- 049_plan_documents.sql
-- PL2: P③ 計画のリライトと docx 出力（本編・簡易版・概要版）
--
-- 設計: claude/coe-x7-pdca-design.md（承認済み v2.2）第2部 P③
-- 確認結果2: 踏襲様式は後日提供 → それまで標準様式（表紙・目次・見出し階層・
--            ページ番号）のプレースホルダで実装し、提供され次第 layout 定義を差し替える
--
-- 【構成】
--   plan_documents        … 計画書の章立てと本文（章ごとの locked でAI再生成から保護）。
--                           variant は文書種別（PL2では 'full'=計画書のみ使用。
--                           PL3で evaluation_report、PL4で deck を追加予定 — CHECK張り替えで拡張）
--   plan_document_exports … docx出力の履歴（S3保存・再出力可能・版管理は上書きでなく追加）
--   ai_task_routing       … generation.plan_doc の種付け
--
-- 方針: MIGRATION_POLICY.md 準拠。新規テーブル＋種付けのみ。冪等。
-- ================================================================

CREATE TABLE IF NOT EXISTS plan_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variant      TEXT        NOT NULL DEFAULT 'full'
                 CHECK (variant IN ('full', 'simple', 'digest')),
  title        TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'finalized')),
  -- [{id, heading, body_md, summary, source_refs[], locked}]
  -- summary は簡易版・概要版の材料（生成時に章ごとに作る — 設計どおり）
  sections     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- 表紙・目次・ヘッダフッタ・章番号スタイル設定（標準様式プレースホルダ。
  -- 踏襲様式の提供後にここを差し替える）
  layout       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- プロジェクト×文書種別で1件（計画書は1プロジェクト1本。再生成は同じ行を更新）
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_documents_project_variant
  ON plan_documents (project_id, variant);

COMMENT ON TABLE plan_documents IS
  '計画書の調製（PL2 P③）。章ごとの locked=true はAI再生成・リライトの対象外。finalized で内容を固定';

CREATE TABLE IF NOT EXISTS plan_document_exports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_document_id UUID        NOT NULL REFERENCES plan_documents(id) ON DELETE CASCADE,
  -- 出力の体裁: full=本編（全章・表紙・目次・頁番号）/ simple=簡易版（章要約＋KPI表＋施策一覧）/
  --             digest=概要版（A4見開き2〜4頁想定: 目標・施策マップ・工程表）
  variant          TEXT        NOT NULL CHECK (variant IN ('full', 'simple', 'digest')),
  s3_key           TEXT        NOT NULL,
  file_name        TEXT        NOT NULL,
  file_size_bytes  BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_document_exports_doc
  ON plan_document_exports (plan_document_id, created_at DESC);

COMMENT ON TABLE plan_document_exports IS
  'docx出力の履歴（S3: plan-documents/ プレフィックス）。再出力は追加（上書きしない）';

-- ── AIタスク種別の種付け ────────────────────────────────
INSERT INTO ai_task_routing (task_type, note) VALUES
  ('generation.plan_doc', '計画書の章立て下書き生成・章別リライト（PL2）')
ON CONFLICT (task_type) DO NOTHING;

-- ── 確認用ログ ───────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'PL2: plan_documents / plan_document_exports / generation.plan_doc を用意しました（標準様式プレースホルダ — 踏襲様式の提供後に layout を差し替え）';
END $$;
