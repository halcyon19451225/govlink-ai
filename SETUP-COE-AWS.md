# Coe（GovLink AI）AWS移行 + Stripe本番化 セットアップ手順

このブランチ（feature/aws-migration）の変更内容:
- **DB**: Supabase Postgres（PG17） → Aurora Serverless v2 PG17（自動一時停止・アイドル時ほぼ0円）
- **ファイル**: Supabase Storage → S3（`src/lib/storage.ts`。knowledge / datasets / avatars / documents を単一バケットに集約）
- **Stripe**: 実装済みの Checkout + Webhook を本番有効化（環境変数の追加のみ）
- **インフラ**: `infra/lib/data-stack.ts`（GovLinkDataStack）を新設

以下は上から順に実行してください。所要 30〜60 分。

---

## ① インフラのデプロイ（Aurora + S3 + IAMユーザー）

```bash
cd ~/Documents/govlink-ai/infra

# （再デプロイ時のみ）過去の失敗で残った空バケットがあれば削除
aws s3 rb s3://govlink-assets-976089672159 2>/dev/null || true

# リージョンで利用可能な Aurora PostgreSQL 17 系の最新バージョン（Supabase が 17 のため同メジャーに揃える）を取得して埋め込み
V=$(aws rds describe-db-engine-versions --engine aurora-postgresql \
  --query "DBEngineVersions[?starts_with(EngineVersion,'17.')].EngineVersion" \
  --output text | tr '\t' '\n' | sort -V | tail -1)
if [ -z "$V" ]; then
  echo "!! PostgreSQL 17系が見つかりません。以下の一覧を確認してください:"
  aws rds describe-db-engine-versions --engine aurora-postgresql \
    --query "DBEngineVersions[].EngineVersion" --output text
else
  echo "Aurora PostgreSQL $V を使用します"
  sed -i '' "s/AURORA_PG17_VERSION/$V/" lib/data-stack.ts
  npx cdk deploy GovLinkDataStack
fi
```

完了時に表示される Outputs を控える:
- `DbEndpoint` … Aurora のホスト名
- `AssetsBucketName` … S3 バケット名（govlink-assets-<アカウントID>）
- `DbSecretArn` … DB パスワードの場所

DBパスワードの確認:
```bash
aws secretsmanager get-secret-value \
  --secret-id /govlink/aurora/credentials \
  --query SecretString --output text
```
（username=govlink_admin と password が表示される）

新しい接続文字列（以後 `AURORA_URL` と呼ぶ）:
```
postgresql://govlink_admin:<password>@<DbEndpoint>:5432/govlink
```

> 💰 コストメモ: min 0 ACU 設定なので、アクセスが無い時間帯は自動停止し
> コンピュート課金ゼロ（ストレージのみ月数十円〜）。停止中の初回アクセスは
> 復帰に15秒ほどかかります。本格運用開始時は min を 0.5 に上げると常時即応になります。

## ② DBデータ移行（Supabase → Aurora）

psql / pg_dump は **17以上** が必要（Supabase が PG17 のため）: `brew install libpq && brew link --overwrite --force libpq` → `pg_dump --version` で確認

```bash
# 1. Supabase からダンプ（数分）
pg_dump "postgresql://postgres.gqozixophkihbotkijdl:bavjuH-5futji-rafcev@aws-1-us-west-2.pooler.supabase.com:6543/postgres" \
  --no-owner --no-privileges --schema=public -Fc -f /tmp/govlink.dump

# 2. Aurora へリストア（初回はDB起動のため15秒ほど待たされることあり）
pg_restore --no-owner --no-privileges -d "<AURORA_URL>" /tmp/govlink.dump

# 3. 確認（テーブル数と主要テーブルの件数）
psql "<AURORA_URL>" -c "\dt" | tail -5
psql "<AURORA_URL>" -c "select count(*) from projects;"
```

## ③ ストレージ移行（Supabase Storage → S3）

IAMコンソールで `govlink-app` ユーザーのアクセスキーを発行:
AWSコンソール → IAM → ユーザー → govlink-app → セキュリティ認証情報 → アクセスキーを作成（用途: サードパーティサービス）

`app/.env.local` の末尾のコメントを実値で有効化:
- `S3_BUCKET_NAME` = ①の AssetsBucketName
- `APP_AWS_ACCESS_KEY_ID` / `APP_AWS_SECRET_ACCESS_KEY` = 発行したキー
- `DATABASE_URL` = `<AURORA_URL>` に差し替え（旧Supabase行はコメントアウトして保管）

移行スクリプト実行:
```bash
cd ~/Documents/govlink-ai/app
node --env-file=.env.local scripts/migrate-storage-to-s3.mjs
```
→ 「コピー完了: N件 / 失敗: 0件」と「avatar_url 書き換え: N行」を確認。

> 補足: 旧S3バケット（govlink-ai-assets-2026）に documents/ の既存ファイルが
> 残っている場合は、次のコマンドで新バケットへ同期:
> `aws s3 sync s3://govlink-ai-assets-2026 s3://<AssetsBucketName>/`

## ④ Stripe 設定（ダッシュボード）

1. https://dashboard.stripe.com → 商品カタログ → 商品を作成
   - 「Coe スタンダード」月額（継続）→ 作成後の **price_...** を控える
   - 「Coe プレミアム」月額（継続）→ 同上
2. 開発者 → Webhook → エンドポイントを追加
   - URL: `https://<Coeの本番ドメイン>/api/billing/stripe/webhook`
   - イベント: `customer.subscription.created` / `customer.subscription.updated` /
     `customer.subscription.deleted` / `invoice.paid`
   - 作成後の **署名シークレット（whsec_...）** を控える
3. 開発者 → APIキー → **シークレットキー（sk_live_...）** を控える
   （まずテスト環境（sk_test_）で動作確認してから本番キーに切替るのが安全）

## ⑤ Amplify Hosting の環境変数を更新

Amplifyコンソール → Coeのアプリ → ホスティング → 環境変数 に追加・変更:

| 変数 | 値 |
|---|---|
| DATABASE_URL | `<AURORA_URL>` |
| S3_BUCKET_NAME | ①の AssetsBucketName |
| APP_AWS_REGION | ap-northeast-1 |
| APP_AWS_ACCESS_KEY_ID | ③のアクセスキー |
| APP_AWS_SECRET_ACCESS_KEY | ③のシークレット |
| STRIPE_SECRET_KEY | sk_live_...（または sk_test_...） |
| STRIPE_STANDARD_PRICE_ID | ④の price_... |
| STRIPE_PREMIUM_PRICE_ID | ④の price_... |
| STRIPE_WEBHOOK_SECRET | whsec_... |

（`scripts/write-env.mjs` がこれらをSSRランタイムに焼き込みます — 対応済み）

## ⑥ デプロイと動作確認

```bash
cd ~/Documents/govlink-ai
git add -A && git commit -m "feat: migrate to Aurora+S3, enable Stripe billing"
git push origin feature/aws-migration
# Amplifyがmainのみ監視の場合は main にマージしてpush
```

確認項目:
1. ログイン → プロジェクト一覧が表示される（= Aurora接続OK）
2. ナレッジ/データセットの既存ファイルが開ける（= S3移行OK）
3. アバター画像が表示される（= 公開URL書き換えOK）
4. 料金ページ → スタンダードを購入（テストカード 4242 4242 4242 4242）
   → 決済後、管理画面のプランが standard に変わる（= Webhook OK）

## ⑦ 後片付け（動作確認が済んでから）

- Supabase プロジェクトを一時停止（すぐ削除しない。1〜2週間問題なければ削除）
- `_to_delete/` フォルダを削除（旧supabase-storage.tsのバックアップ等）
- 安定後: AWSコンソールで Aurora の削除保護を ON に

---

## Ordo管理画面との連携（別リポジトリ OrdoWebsite・対応済み）

- Customer に **製品（Libera / Coe）** フィールドを追加。管理画面で製品を選択して
  顧客登録・フィルタ・CSV出力が可能に
- ライセンス照会APIが製品対応: `GET /api/license?customerId=xxx&product=Coe`
  （製品不一致は active:false / reason: product_mismatch）
- OrdoWebsite を push すればスキーマ含め自動デプロイされる（既存レコードは Libera 扱い）
- 将来: Coe 側に定期的な /api/license 照会を組み込むと、Ordo管理画面から
  Coe の使用許諾を直接制御できる（Liberaと同様の構想）
