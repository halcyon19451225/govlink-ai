#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { BaseStack } from '../lib/base-stack';

const app = new cdk.App();

// BaseStack: VPC, ECS Cluster, Aurora Serverless v2, S3, CloudFront, Cognito (常時デプロイ)
new BaseStack(app, 'GovLinkBaseStack', {
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'ap-northeast-1',
  },
  description: 'GovLink AI — BaseStack (VPC / ECS / Aurora / S3 / CloudFront / Cognito)',
});
