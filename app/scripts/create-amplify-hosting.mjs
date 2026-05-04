import { mkdirSync, writeFileSync, cpSync } from 'fs'

const standaloneDir = '.next/standalone'
const hostingDir = '.amplify-hosting'

mkdirSync(`${hostingDir}/compute/default`, { recursive: true })
mkdirSync(`${hostingDir}/static`, { recursive: true })

cpSync(standaloneDir, `${hostingDir}/compute/default`, { recursive: true })

cpSync('.next/static', `${hostingDir}/static/_next/static`, { recursive: true })

const manifest = {
  version: 1,
  routes: [
    {
      path: '/_next/static/*',
      target: {
        kind: 'Static'
      }
    },
    {
      path: '/favicon.ico',
      target: {
        kind: 'Static'
      }
    },
    {
      path: '/*',
      target: {
        kind: 'Compute',
        src: 'default'
      }
    }
  ],
  computeResources: [
    {
      name: 'default',
      runtime: 'nodejs20.x',
      entrypoint: 'server.js'
    }
  ],
  framework: {
    name: 'next',
    version: '14.2.35'
  }
}

writeFileSync(`${hostingDir}/deploy-manifest.json`, JSON.stringify(manifest, null, 2))

console.log('.amplify-hosting directory created successfully')
