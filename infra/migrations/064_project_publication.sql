-- ================================================================
-- Migration 064: projects.published_at — 公開ページに出す政策を明示的に選ぶ
-- ================================================================
--
-- 背景（2026-09-07・claude/coe-tenant-isolation.md §11）:
--   `/public/[slug]` と `/api/public/projects/[slug]` は未認証で到達できる
--   住民向けの公開面だが、**何を公開するかを誰も選んでいなかった**。
--
--     SELECT ... FROM projects p JOIN municipalities m ON m.id = p.municipality_id
--     WHERE m.slug = $1 ORDER BY p.created_at DESC LIMIT 1
--
--   引いているのは自治体の slug で、出るのは「その自治体で**一番新しく作られた**政策」。
--   `status` の絞り込みも無いため、`draft`（未公開の計画）が KPI の目標値ごと
--   公開されていた。本番で実際に、御船町の第9期計画が status=draft のまま
--   KPI 24件を目標値つきで未認証に返していることを確認した。
--
--   構造の問題は「draft が出ること」より「**選択が暗黙**であること」にある。
--   テスト用に政策を1件作れば、それが自動的にその自治体の公開ページになる。
--   実際、福祉課テナントの公開ページは「サンプル政策」だった。
--
-- 方針: **公開は明示的な行為にする。既定は非公開（fail closed）。**
--   公開フラグを boolean ではなく「公開した日時」にしているのは、
--   posts.published_at と同じ形にして、いつ公開したかを残すため。
--   NULL = 非公開。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

COMMENT ON COLUMN projects.published_at IS
  '住民向け公開ページに出した日時。NULL は非公開。既定は NULL（非公開）';

-- 公開対象を引くための部分インデックス（公開済みは少数である前提）
CREATE INDEX IF NOT EXISTS idx_projects_published
  ON projects (municipality_id, published_at DESC)
  WHERE published_at IS NOT NULL;

-- ⚠ **既存行は意図的に NULL のままにする（＝全件が非公開になる）。**
--   ここで「今まで見えていたものは見えたままにする」ために既存を公開扱いすると、
--   選ばれてもいない draft がそのまま公開され続ける。この migration の目的に反する。
--   公開したい政策は、管理画面から明示的に公開すること。
