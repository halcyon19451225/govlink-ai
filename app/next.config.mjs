import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // M1: マニュアル正本（src/content/manual/*.md）は実行時に読み込むため、
  // standalone のファイルトレースに明示的に含める（無いと本番で「準備中」になる）
  experimental: {
    outputFileTracingIncludes: {
      '/manual': ['./src/content/manual/**/*'],
      '/manual/[topicId]': ['./src/content/manual/**/*'],
      '/api/manual/[topicId]': ['./src/content/manual/**/*'],
    },
    // Next 14 でのキー名は experimental.serverComponentsExternalPackages。
    // 素の serverExternalPackages（Next 15 の書き方）はここでは認識されず、
    // 「Unrecognized key(s)」の警告とともに黙って無視される
    // （＝ pdf-parse などがバンドルされ、本番の本文抽出が壊れうる）。
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth', 'pdfjs-dist'],
  },
  transpilePackages: ['three'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      // Google アカウント画像
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      // Apple / Microsoft アカウント画像
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.windows.net',
      },
      // S3 アバター
      {
        protocol: 'https',
        hostname: '*.amazonaws.com',
      },
    ],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, './src'),
    }
    return config
  },
}

export default nextConfig
