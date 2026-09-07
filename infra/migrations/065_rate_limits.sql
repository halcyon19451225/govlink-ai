-- ================================================================
-- Migration 065: rate_limits — 未認証エンドポイントの回数制限
-- ================================================================
--
-- 背景（2026-09-07・claude/coe-tenant-isolation.md §10-7）:
--   リポジトリ全体にレート制限の実装が1つも無かった（WAF も CAPTCHA も無し）。
--   未認証で POST を受けるエンドポイントのうち、次の3本は
--   **1リクエストにつきメールが1〜2通飛ぶ**:
--
--     /api/contact          … 管理者宛の通知 ＋ 申込者宛の自動返信
--     /api/auth/register    … Cognito のメール確認
--     /api/auth/forgot-password … Cognito のパスワード再設定
--
--   加えて /api/auth/register は自治体名の名前空間を占拠できる
--   （実在自治体名を先に登録され、正規の登録が 409 で妨害される）。
--
-- なぜ DB に持つのか
-- ------------------
--   Amplify SSR は Lambda で動くため、**プロセス内のメモリはインスタンス間で
--   共有されない**。Map によるカウンタはスケールアウトで素通りし、
--   コールドスタートで消える。「制限しているつもり」が最も危ない。
--   DB に置けばインスタンス横断で正しく効く。対象は低頻度な公開フォームのみなので、
--   1リクエストあたりの書き込み1〜2回は問題にならない。
--
-- 固定窓（fixed window）方式
-- --------------------------
--   window_started_at から windowSeconds の間の回数を数える。窓をまたぐと 1 に戻す。
--   窓の境界で瞬間的に上限の2倍まで通りうるが、目的は「メール送信の踏み台化と
--   総量の抑制」であって精密な整形ではないため、この単純さを採る。
--   増加とリセット判定は 1 本の INSERT ... ON CONFLICT DO UPDATE で行うので、
--   同時リクエストでも行ロックにより取りこぼさない（src/lib/rate-limit.ts）。

CREATE TABLE IF NOT EXISTS rate_limits (
  -- '<scope>:<kind>:<value>' の形。例: 'contact:ip:203.0.113.9' / 'contact:email:a@example.jp'
  -- 値は src/lib/rate-limit.ts で小文字化・長さ制限してから組み立てる
  -- （長大な X-Forwarded-For を投げ込まれてもキーが膨らまないようにするため）
  bucket            TEXT        PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  count             INTEGER     NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE rate_limits IS
  '未認証エンドポイントの回数制限（固定窓）。Amplify SSR は Lambda のため、プロセス内メモリでは効かない';
COMMENT ON COLUMN rate_limits.bucket IS
  '"<scope>:<kind>:<value>"。値は正規化済み。scope はエンドポイント、kind は ip / email など';
COMMENT ON COLUMN rate_limits.window_started_at IS
  '現在の窓の開始時刻。now() - window_started_at が窓幅を超えたら count を 1 に戻す';

-- 期限切れ行の掃除用（src/lib/rate-limit.ts が低確率で DELETE する）
CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON rate_limits (window_started_at);

-- ⚠ このテーブルはテナントに属さない（未認証の相手を数えるため municipality_id は持たない）。
--   テナント境界の検査（check:tenant）の対象外であることは意図的。
