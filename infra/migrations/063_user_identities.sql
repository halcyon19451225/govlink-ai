-- ================================================================
-- Migration 063: user_identities — 1人の利用者に複数の Cognito identity を紐付ける
-- ================================================================
--
-- 背景（2026-09-06）:
--   Coe は権限を user_roles.email で解決していた。メールは可変で、同じ値が
--   複数テナントに存在しうるため、認可の鍵として不適切だった（詳細は
--   プロジェクト文書 claude/ordo-id-design.md §4）。
--   sub 基準に移そうとしたところ、実データで次が判明した:
--
--     1人の人間が Cognito 上に2つの identity を持っている
--       ・ネイティブ（メール+パスワード）: sub 47943a48… / 77342a98…
--       ・Google 連携（EXTERNAL_PROVIDER）: sub 27545a88… / 77543a78…
--
--   user_roles.cognito_user_id は1つしか持てないため、どちらか一方の
--   ログイン方法しか通らない。Cognito の admin-link-provider-for-user で
--   統合する手もあるが、重複する連携ユーザーの削除を伴い、
--   **27545a88… は Libera の運営者アカウントの sub と同一**なので、
--   消すと Libera 側の所有権が壊れる。よって「1対多」で表現する。
--
-- ⚠ cognito_sub に全体 UNIQUE を張っていないのは意図的。
--   1人が複数の自治体に所属しうる（実データで ordoservice… が
--   御船町と福祉課の両方に user_roles 行を持つ）ため、
--   同じ sub が複数の user_role_id に紐づく。
--   その場合の所属選択は未解決の課題で、当面はアプリ側が
--   「最も古い所属」を決定的に選び、複数該当時は警告を出す。

CREATE TABLE IF NOT EXISTS user_identities (
  user_role_id UUID NOT NULL REFERENCES user_roles(id) ON DELETE CASCADE,
  cognito_sub  TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'cognito'
    CHECK (provider IN ('cognito', 'google')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_role_id, cognito_sub)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_sub ON user_identities(cognito_sub);

-- 既存 user_roles の cognito_user_id を初期データとして取り込む。
-- ただし 'google_' で始まる値は Cognito の *ユーザー名* であって sub ではないため除外する
-- （実データに user_roles.cognito_user_id = 'google_110537…' の行がある）。
INSERT INTO user_identities (user_role_id, cognito_sub, provider)
SELECT id, cognito_user_id, 'cognito'
FROM user_roles
WHERE cognito_user_id IS NOT NULL
  AND cognito_user_id <> ''
  AND cognito_user_id NOT LIKE 'google\_%'
ON CONFLICT DO NOTHING;
