import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * DataStack: GovLink AI のデータ基盤（Supabase 移行先）
 *
 * - Aurora Serverless v2 (PostgreSQL 16) — 自動一時停止（0 ACU）対応
 *   Amplify Hosting の SSR（VPC 外の Lambda）から接続するため
 *   パブリックアクセス可能な構成にする（Supabase と同じ接続モデル。
 *   認証は Secrets Manager 管理の強力なパスワードで担保）
 * - S3 アプリ資産バケット（knowledge/ datasets/ avatars/ documents/ プレフィックス。
 *   avatars/ のみ公開読み取り）
 * - アプリ用 IAM ユーザー（S3 アクセス用。アクセスキーはコンソールで発行）
 *
 * BaseStack とは独立してデプロイできる（BaseStack のデプロイは不要）。
 */
export class DataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC（パブリックサブネットのみ・NAT なし＝追加コストなし） ──
    const vpc = new ec2.Vpc(this, 'DataVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
      ],
    });

    // ── DB 認証情報（Secrets Manager） ────────────────────────
    const dbSecret = new secretsmanager.Secret(this, 'AppDbSecret', {
      secretName: '/govlink/aurora/credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'govlink_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // ── セキュリティグループ（5432 を全体公開。Supabase と同じモデル） ──
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'AppDbSecurityGroup', {
      vpc,
      description: 'GovLink Aurora - public PostgreSQL access',
      allowAllOutbound: true,
    });
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'PostgreSQL from anywhere (Amplify SSR / local dev)',
    );

    // ── Aurora Serverless v2 (PostgreSQL 17・自動一時停止) ─────
    const dbCluster = new rds.DatabaseCluster(this, 'AppDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        // Supabase 側が PostgreSQL 17 のため、同メジャーの 17 系を使用
        // （17.10 はデプロイコマンド内の sed で実バージョンに置換される）
        version: rds.AuroraPostgresEngineVersion.of('17.10', '17'),
      }),
      serverlessV2MinCapacity: 0, // 0 ACU = アイドル時は自動停止（課金ほぼゼロ）
      serverlessV2MaxCapacity: 2,
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: true,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      defaultDatabaseName: 'govlink',
      backup: { retention: cdk.Duration.days(7) },
      deletionProtection: false, // 本番移行完了後に true へ
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // ── S3 アプリ資産バケット ──────────────────────────────────
    // avatars/ プレフィックスのみ公開読み取り（アバター画像の恒久 URL 用）
    const assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `govlink-assets-${this.account}`,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      encryption: s3.BucketEncryption.S3_MANAGED,
      // DESTROY でもバケットに1つでもオブジェクトがあれば CloudFormation は削除できない
      // （= データは保護される）。RETAIN だと作成失敗のロールバックで空バケットが
      // 残骸として残り、再デプロイが名前衝突で失敗するため DESTROY とする。
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    assetsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'PublicReadAvatars',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject'],
        resources: [assetsBucket.arnForObjects('avatars/*')],
      }),
    );

    // ── アプリ用 IAM ユーザー（Amplify SSR から S3 を使うための資格情報） ──
    // アクセスキーは IAM コンソールで発行し、Amplify 環境変数
    // APP_AWS_ACCESS_KEY_ID / APP_AWS_SECRET_ACCESS_KEY に設定する
    const appUser = new iam.User(this, 'AppUser', {
      userName: 'govlink-app',
    });
    appUser.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [assetsBucket.bucketArn, assetsBucket.arnForObjects('*')],
      }),
    );

    // ── Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: dbCluster.clusterEndpoint.hostname,
      description: 'Aurora クラスターエンドポイント（DATABASE_URL のホスト部）',
    });
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbSecret.secretArn,
      description: 'DB 認証情報（Secrets Manager）',
    });
    new cdk.CfnOutput(this, 'AssetsBucketName', {
      value: assetsBucket.bucketName,
      description: 'S3_BUCKET_NAME に設定する値',
    });
    new cdk.CfnOutput(this, 'AppUserName', {
      value: appUser.userName,
      description: 'S3 アクセス用 IAM ユーザー（アクセスキーをコンソールで発行）',
    });
  }
}
