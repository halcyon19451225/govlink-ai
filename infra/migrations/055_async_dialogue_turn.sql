-- 055: 対話型モジュールのAIターン非同期化
--
-- 背景: Amplify Hosting の API 応答上限（30秒）により、AI処理（web_search 併用・
-- 追いターン）が長引くと、サーバー側は処理を完了して保存しているのに応答が
-- ゲートウェイで切断され、画面が「通信エラー」を表示していた。
--
-- 対策: POST /chat は発言を保存して即応答（202）し、AI処理は自己呼び出しの
-- ステップ（step_token 認証）で行う。画面は turn_status をポーリングする。
-- 4対話（現状整理・課題仮説設定・施策構築・改善）に同じ列を追加する。
--
-- turn_status: idle（待機） / processing（AI処理中） / error（失敗・再試行可）
-- turn_started_at: processing になった時刻（3分超は失効扱いで再試行を許可）
-- turn_token: ステップ呼び出しの認証トークン（処理中のみ非NULL）
-- turn_error: 失敗理由（画面表示用）

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asis_analyses', 'issue_dialogues', 'measure_dialogues', 'improvement_dialogues']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS turn_status TEXT NOT NULL DEFAULT ''idle''', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS turn_started_at TIMESTAMPTZ NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS turn_token TEXT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS turn_error TEXT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_turn_status_check');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (turn_status IN (''idle'', ''processing'', ''error''))',
      t, t || '_turn_status_check'
    );
  END LOOP;
END $$;
