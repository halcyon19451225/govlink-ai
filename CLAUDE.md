# GovLink AI — プロジェクト設計書
## プロジェクト概要
日本の自治体・民間企業向けAI政策管理SaaS。
AIロジックモデル自動生成・SNS公開フィード機能を持つ。
## 技術スタック
- Next.js 14 (App Router, TypeScript strict)
- AWS Lambda (公開ルート), ECS Fargate (管理・AIルート)
- Aurora Serverless v2 (PostgreSQL 15互換)
- Amazon Cognito (認証)
- CloudFront (CDN) + S3 (静的ファイル)
- AWS CDK v2 (IaC: infra/ 以下)
- Anthropic Claude API (claude-sonnet-4-6)
## ルート分割ルール（厳守）
/public/*     → Lambda (常時稼働・無料枠)
/api/public/* → Lambda (常時稼働・無料枠)
/admin/*      → ALB → ECS Fargate (起動時のみ)
/api/ai/*     → ALB → ECS Fargate (Claude API呼び出し)
/api/auth/*   → Cognito エンドポイント
## DBスキーマ（主要テーブル）
municipalities: id, name, slug, prefecture
projects: id, municipality_id, title, description, status, created_at
kpis: id, project_id, label, target, current, unit
posts: id, project_id, type(plan/progress/result), body, ai_summary, published_at
logic_models: id, project_id, inputs, activities, outputs, outcomes (jsonb), generated_at
## CDKスタック構成（infra/）
BaseStack: VPC, ECS Cluster, Aurora Serverless v2, S3, CloudFront, Cognito (常時デプロイ)
LgwanStack: VPN Gateway, Customer Gateway, Route tables (商談成立後のみデプロイ)
## コーディング規約
- TypeScript strict: true
- コメントは日本語可
- エラーメッセージは日本語
- 環境変数はzodで検証（型アサーション禁止）
- DB接続: pg (pool)、接続文字列はSecrets Managerから取得
- APIレスポンス: { data, error } 形式で統一
## 未実装・後回し事項
- LgwanStack（自治体との商談成立後に実装）
- NAT Gateway（MVP段階は省略）
- Multi-AZ（Phase2以降）
