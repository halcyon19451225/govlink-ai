-- 056: AI利用ログにプロンプトキャッシュのトークン数を記録する
--
-- 背景: Anthropic API の usage は入力を3つに分けて返す。
--   input_tokens                … キャッシュに当たらず、通常単価で課金された分
--   cache_creation_input_tokens … キャッシュに書き込んだ分（通常より割増）
--   cache_read_input_tokens     … キャッシュから読んだ分（通常の約1割）
-- ai_usage_logs は input_tokens しか保存していなかったため、
-- キャッシュが効いているのか、書き込みの割増だけを払っているのかを
-- ログから判断できなかった（2026-08-30、キャッシュ設計の見直し時に判明）。
--
-- 既存行は NULL のまま（記録が無かった期間と、効いていなかった期間は区別できない）。

ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER;

COMMENT ON COLUMN ai_usage_logs.cache_write_tokens IS
  'プロンプトキャッシュへ書き込んだ入力トークン数（通常単価より割増で課金される）';
COMMENT ON COLUMN ai_usage_logs.cache_read_tokens IS
  'プロンプトキャッシュから読んだ入力トークン数（通常単価の約1割で課金される）';

DO $$
BEGIN
  RAISE NOTICE 'ai_usage_logs にキャッシュのトークン数（write/read）を追加しました';
END $$;
