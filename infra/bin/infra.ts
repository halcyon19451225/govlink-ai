#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { BaseStack } from '../lib/base-stack';
import { DataStack } from '../lib/data-stack';

const app = new cdk.App();

const env = {
  account: process.env['CDK_DEFAULT_ACCOUNT'],
  region: process.env['CDK_DEFAULT_REGION'] ?? 'ap-northeast-1',
};

// BaseStack: VPC, ECS Cluster, Aurora Serverless v2, S3, CloudFront, Cognito (将来フェーズ・未デプロイ)
new BaseStack(app, 'GovLinkBaseStack', {
  env,
  description: 'GovLink AI — BaseStack (VPC / ECS / Aurora / S3 / CloudFront / Cognito)',
});

// DataStack: Supabase 移行先（Aurora Serverless v2 自動停止 + S3 資産バケット）
// デプロイ: npx cdk deploy GovLinkDataStack
new DataStack(app, 'GovLinkDataStack', {
  env,
  description: 'GovLink AI — DataStack (Aurora Serverless v2 auto-pause / S3 assets / app IAM user)',
});
