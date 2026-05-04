import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __dirname = fileURLToPath(new URL('.', import.meta.url))

const { withAmplifyHosting } = require('@aws-amplify/adapter-nextjs/with-amplify-hosting')

/** @type {import('next').NextConfig} */
const nextConfig = withAmplifyHosting({
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, './src'),
    }
    return config
  },
})

export default nextConfig
