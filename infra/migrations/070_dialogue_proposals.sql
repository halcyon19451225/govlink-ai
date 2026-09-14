-- ================================================================
-- Migration 070: 対話からの提案 — 承認して初めて登録される
-- ================================================================
--
-- 設計: claude/coe-dataset-model.md §10-3（提案 → 承認 → 登録 → 待機 → 再開）・§10-5（操作の同一性）
--
-- なぜ必要か
-- ----------
--   施策構築の対話で AI が「この指標が要る」と気づいたとき、**勝手に箱や指標を作らせない**。
--   提案を1行として残し、担当者が承認したときだけ登録する。見送った提案も残す
--   （「何を提案され、なぜ採らなかったか」は後から効いてくる）。
--
--   登録したあとは「データが上がるのを待っている」状態になる。待機は対話を止める
--   ブロックではなく、対話に付いた状態（data_state）。
--
-- 置いた解釈
-- ----------
--   ・提案の表は**対話の種類を問わない**（dialogue_kind で分ける）。最初に載せるのは
--     施策構築だけだが（設計 §15-8）、表は現状整理・課題仮説にもそのまま使える
--   ・待機の状態と「次のターンの冒頭に差し込むデータ行」は、対話ごとの列として持つ。
--     非同期ターンの turn_status / turn_token と同じ流儀（対話の表に付く）
--   ・提案の承認で作られた箱・指標は、画面から作ったものと**同じ表の同じ形**になる。
--     違いは datasets.created_via / activity_log.via の1列だけ

-- ────────────────────────────────────────────────────────────────
-- 1. 提案
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dialogue_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- どの対話から出た提案か。'measure' だけを載せるが、表は種類を問わない
  dialogue_kind   TEXT NOT NULL CHECK (dialogue_kind IN ('measure', 'asis', 'issue', 'improvement')),
  dialogue_id     UUID NOT NULL,
  turn_no         INTEGER NOT NULL DEFAULT 0,
  -- 対話の中での通し名。指標の提案が「どの箱の提案に依存するか」を指すのに使う。
  -- 同じ ref を何度出されても提案は増えない（AI が言い直しても重複しない）
  ref             TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('dataset', 'indicator')),
  -- 提案の中身（AI の出力を検証・整形したもの）。登録時の入力になる
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  -- 決めた人。**AI ではない**（設計 §10-5）
  decided_by      UUID REFERENCES user_roles(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decline_reason  TEXT,
  -- 承認して作られた実体
  dataset_id      UUID REFERENCES datasets(id) ON DELETE SET NULL,
  indicator_id    UUID REFERENCES indicators(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dialogue_proposals_ref_uq UNIQUE (dialogue_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_dialogue_proposals_dialogue
  ON dialogue_proposals(dialogue_kind, dialogue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dialogue_proposals_dataset
  ON dialogue_proposals(dataset_id) WHERE dataset_id IS NOT NULL;

COMMENT ON TABLE dialogue_proposals IS
  '対話から出た提案。承認されるまで何も作らない。見送った提案も残る（設計 §10-3）';
COMMENT ON COLUMN dialogue_proposals.decided_by IS
  '承認・見送りを決めた担当者（user_roles.id）。AI は決められない';
COMMENT ON COLUMN dialogue_proposals.ref IS
  '対話の中での通し名。指標の提案が依存する箱の提案を指すのに使う。重複提案の抑止も兼ねる';

-- ────────────────────────────────────────────────────────────────
-- 2. 対話側の状態（待機と、次のターンへ渡すデータ行）
-- ────────────────────────────────────────────────────────────────
--   待機は**ブロックではない**。担当者は待っている間も対話を続けられる（設計 §10-3）。
ALTER TABLE measure_dialogues ADD COLUMN IF NOT EXISTS data_state TEXT NOT NULL DEFAULT 'none';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'measure_dialogues_data_state_chk') THEN
    ALTER TABLE measure_dialogues ADD CONSTRAINT measure_dialogues_data_state_chk
      CHECK (data_state IN ('none', 'waiting_for_data'));
  END IF;
END $$;

--   次のターンの冒頭に差し込むデータ行（指標の計算結果・不足の案内・承認や取込の記録）。
--   AI の要求はターンをまたいで返る（設計 §10-2・Amplify の 30 秒制限）。
ALTER TABLE measure_dialogues ADD COLUMN IF NOT EXISTS pending_inputs JSONB NOT NULL DEFAULT '[]'::jsonb;

--   このターンを回している担当者（user_roles.id）。
--   AI 処理の実体はトークン認証の自己呼び出しで動くのでセッションが無い。
--   **その処理が書くものの actor は、この対話を進めている担当者**（設計 §10-5）。
ALTER TABLE measure_dialogues ADD COLUMN IF NOT EXISTS turn_actor UUID REFERENCES user_roles(id) ON DELETE SET NULL;

COMMENT ON COLUMN measure_dialogues.data_state IS
  'waiting_for_data = 承認して作った箱にデータが上がるのを待っている。対話は続けられる';
COMMENT ON COLUMN measure_dialogues.pending_inputs IS
  '次のターンの冒頭に差し込むデータ行 [{kind, text, at}]。差し込んだら空にする';
COMMENT ON COLUMN measure_dialogues.turn_actor IS
  'AI 処理が書くものの actor。AI 自身ではなく、この対話を進めている担当者';

-- ────────────────────────────────────────────────────────────────
-- 3. 操作履歴の対象に提案を加える
-- ────────────────────────────────────────────────────────────────
COMMENT ON TABLE activity_log IS
  '操作履歴。人が画面から操作しても AI が操作しても同じ形で残る。entity: dataset / dataset_version / attribute / key_type / indicator / indicator_target / indicator_value / proposal';
