import { writeFileSync, mkdirSync, readFileSync } from 'fs'

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
const written = readFileSync('.amplify-hosting/compute/default/.env', 'utf8')
console.log('Written .env content (DATABASE_URL line):',
  written.split('\n').find(l => l.startsWith('DATABASE_URL='))?.substring(0, 60))

// .envを読み込んでからserver.jsを起動するラッパー
// Next.js standaloneのserver.jsは.envを自動ロードしないため必要
const runJs = `const fs = require('fs')
const path = require('path')
const envPath = path.join(__dirname, '.env')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\\n')
  for (const line of lines) {
    const idx = line.indexOf('=')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1)
      if (key && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }
}
require('./server.js')
`
writeFileSync('.amplify-hosting/compute/default/run.js', runJs)
console.log('run.js wrapper created')
