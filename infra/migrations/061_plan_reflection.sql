-- 061_plan_reflection.sql
-- CA2-7a: 収束工程の様式（G1・G2・G4・H3・H4）の手入力欄の保存先
--
-- 設計: claude/coe-eval-reflect-forms.md
--   転記ゼロ原則: 判定・ルート・標準処遇・決定処遇・理由書の有無は program_evaluations（060）から
--   自動生成する。この表が持つのは**手で起こす欄だけ**:
--     G1-6 決定処遇の履歴（答申による修正） / G1-8 次期計画の反映箇所 / G2-4 採否
--     G4-①  諮問の基本事項 / G4-⑧ 判断4軸の所見 / G4-⑨ 関係機関の意見 / G4-⑪ 資源の異動
--     H4-3  決定（処遇決定会議・答申） / H1-9 訂正・整理注記
--   1行 = 報告書1件 = 主要施策評価1件（evaluation_id で一意）。
--   G1-8 はクローン改修（CA2-7 本体）前は手入力。照合（停止条件）は warning 止まり。
--
-- 冪等: CREATE TABLE IF NOT EXISTS のみ。
-- ※ このファイルに BEGIN/COMMIT は書かない（ランナーがトランザクションを張る）。

CREATE TABLE IF NOT EXISTS plan_reflections (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  measure_design_id    UUID        NOT NULL REFERENCES measure_designs(id) ON DELETE CASCADE,
  evaluation_id        UUID        NOT NULL UNIQUE REFERENCES program_evaluations(id) ON DELETE CASCADE,

  -- G1-6: 決定処遇の履歴 [{ at, by, stage: 'draft'|'council'|'reply', decided_treatment, reason }]
  --   現在値は program_evaluations.decided_treatment（写し先）。履歴はここに追記型で残す
  decision_history     JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- G1-8: 次期計画の反映箇所
  --   measure … 次期施策（reflect_measure_id＝クローン後の measure_designs.id。手動リンク）
  --   chapter … 章・頁・総論など（reflect_location に記述）
  --   not_adopted … 不採用（reflect_reason 必須。行き先として有効）
  reflect_kind         TEXT
    CONSTRAINT plan_reflections_kind_chk
    CHECK (reflect_kind IS NULL OR reflect_kind IN ('measure', 'chapter', 'not_adopted')),
  reflect_measure_id   UUID        REFERENCES measure_designs(id) ON DELETE SET NULL,
  reflect_location     TEXT,
  reflect_reason       TEXT,

  -- G2-4: 標準処遇に対する採否（既定は 標準どおり=adopted／異なる=partial。担当者が rejected に変えられる）
  adoption             TEXT
    CONSTRAINT plan_reflections_adoption_chk
    CHECK (adoption IS NULL OR adoption IN ('adopted', 'partial', 'rejected')),

  -- G4-①: 諮問の基本事項
  inquiry_no           TEXT,
  inquiry_date         DATE,
  reply_due            DATE,
  -- G4-⑧: 判断4軸の所見 { a: 整合性, b: 改善可能性, c: 明確さ, d: 実務妥当性 }（各 事実→評価の順）
  opinions             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- G4-⑨: 関係機関の意見と、事務局案への反映状況（反映しなかった理由を含む）
  stakeholder_opinions TEXT,
  -- G4-⑪: 資源の異動 { delta_amount, released_amount, reallocation_to, budget_neutral, note }（千円）
  resource_change      JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- 段階2-4 答申 ＝ H4-3 決定
  reply_result         TEXT,
  reply_date           DATE,
  decided_on           DATE,
  decision_meeting     TEXT,

  -- H1-9: セットごとの訂正・整理注記 { "<measure_work_id>|measure": "…" }
  set_notes            JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_reflections_project
  ON plan_reflections (project_id, measure_design_id);

DROP TRIGGER IF EXISTS set_updated_at_plan_reflections ON plan_reflections;
CREATE TRIGGER set_updated_at_plan_reflections
    BEFORE UPDATE ON plan_reflections
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE plan_reflections IS
  '収束工程の手入力欄（G1-6/G1-8/G2-4/G4①⑧⑨⑪/H4-3/H1-9）。判定・処遇の本体は program_evaluations（060）';

-- ─── 様式H3 未反映事項台帳 ────────────────────────────────
-- 今期反映できなかった知見を登録し、年次評価で必ず再上程する（「見送り」を「消滅」にしない）。
-- 状態: deferred（見送り）→ re_proposed（再上程）→ adopted（採用）／dropped（取り下げ・理由必須）
CREATE TABLE IF NOT EXISTS plan_deferred_items (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reflection_id         UUID        REFERENCES plan_reflections(id) ON DELETE SET NULL,
  evaluation_id         UUID        REFERENCES program_evaluations(id) ON DELETE SET NULL,
  -- H3-1 事項（出典: 報告書No.・G3知見ID を source_ref に）
  title                 TEXT        NOT NULL,
  detail                TEXT,
  source_ref            TEXT,
  -- H3-2 見送りの理由
  reason_kind           TEXT        NOT NULL DEFAULT 'other'
    CONSTRAINT plan_deferred_reason_chk
    CHECK (reason_kind IN ('budget', 'staff', 'coordination', 'verification', 'other')),
  reason                TEXT,
  -- H3-3 再検討期日（年次評価の時期に合わせる）
  review_due            DATE,
  -- H3-4 再上程の条件（再上程を発動する事実）
  condition             TEXT,
  status                TEXT        NOT NULL DEFAULT 'deferred'
    CONSTRAINT plan_deferred_status_chk
    CHECK (status IN ('deferred', 're_proposed', 'adopted', 'dropped')),
  re_proposed_fiscal_year INT,
  status_note           TEXT,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_deferred_project
  ON plan_deferred_items (project_id, status);

DROP TRIGGER IF EXISTS set_updated_at_plan_deferred_items ON plan_deferred_items;
CREATE TRIGGER set_updated_at_plan_deferred_items
    BEFORE UPDATE ON plan_deferred_items
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE plan_deferred_items IS
  '様式H3 未反映事項台帳。deferred→re_proposed（年次評価で再上程）→adopted/dropped';

DO $$ BEGIN
  RAISE NOTICE 'CA2-7a: plan_reflections（G1/G2/G4/H4/H1-9 の手入力欄）と plan_deferred_items（H3）を用意しました';
END $$;
