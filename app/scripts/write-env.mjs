import { writeFileSync, mkdirSync } from 'fs'

mkdirSync('.amplify-hosting/compute/default', { recursive: true })

const env = {
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
  COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
  COGNITO_CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ESTAT_API_KEY: process.env.ESTAT_API_KEY,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
  NODE_ENV: 'production'
}

const content = Object.entries(env)
  .filter(([k, v]) => v)
  .map(([k, v]) => k + '=' + v)
  .join('\n')

writeFileSync('.amplify-hosting/compute/default/.env', content)
console.log('ENV vars written:', Object.keys(env).filter(k => env[k]).join(', '))
