import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * BaseStack: GovLink AI の常時デプロイインフラ
 * - VPC (NAT Gateway省略 / MVPフェーズ)
 * - ECS Fargate クラスター (管理・AIルート用)
 * - Aurora Serverless v2 (PostgreSQL 15互換)
 * - S3 (静的ファイル)
 * - CloudFront (CDN)
 * - Amazon Cognito (認証)
 */
export class BaseStack extends cdk.Stack {
  /** Aurora DBクラスター（他スタックから参照可能） */
  public readonly dbCluster: rds.DatabaseCluster;
  /** ECS クラスター（他スタックから参照可能） */
  public readonly ecsCluster: ecs.Cluster;
  /** Cognito ユーザープール */
  public readonly userPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC ──────────────────────────────────────────────────
    // MVPフェーズ: NAT Gateway 省略（コスト削減）
    const vpc = new ec2.Vpc(this, 'GovLinkVpc', {
      maxAzs: 2,
      natGateways: 0, // Phase2以降で追加
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ── ECS Fargate クラスター ────────────────────────────────
    // /admin/* と /api/ai/* のトラフィックを処理（起動時のみ）
    this.ecsCluster = new ecs.Cluster(this, 'GovLinkCluster', {
      vpc,
      clusterName: 'govlink-cluster',
      containerInsights: true,
    });

    // ── Aurora Serverless v2 (PostgreSQL 15) ──────────────────
    // DB認証情報を Secrets Manager で管理（CLAUDE.md規約準拠）
    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: '/govlink/db/credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'govlink_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Aurora Serverless v2 セキュリティグループ',
      allowAllOutbound: false,
    });

    this.dbCluster = new rds.DatabaseCluster(this, 'GovLinkDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      writer: rds.ClusterInstance.serverlessV2('writer'),
      // Multi-AZ: Phase2以降
      // readers: [rds.ClusterInstance.serverlessV2('reader')],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbSecret),
      defaultDatabaseName: 'govlink',
      backup: { retention: cdk.Duration.days(7) },
      deletionProtection: false, // 本番移行時に true へ変更
    });

    // ── S3 (静的ファイル) ──────────────────────────────────────
    const staticBucket = new s3.Bucket(this, 'StaticBucket', {
      bucketName: `govlink-static-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── CloudFront (CDN) ──────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'GovLinkCdn', {
      comment: 'GovLink AI CDN',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(staticBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // 北米・欧州・アジア
    });

    // ── Amazon Cognito (認証) ──────────────────────────────────
    this.userPool = new cognito.UserPool(this, 'GovLinkUserPool', {
      userPoolName: 'govlink-user-pool',
      selfSignUpEnabled: false, // 自治体管理者のみ招待制
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'govlink-web-client',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      },
    });

    // ── CloudFormation Outputs ────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront ディストリビューション URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito ユーザープール ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito ウェブクライアント ID',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbSecret.secretArn,
      description: 'DB認証情報 Secrets Manager ARN',
    });
  }
}
