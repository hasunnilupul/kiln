import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// turbopack.root is left to Next.js, which detects the workspace root from pnpm-lock.yaml.
const nextConfig: NextConfig = {
  // Client builds ship the standalone server (scripts/build-client.ts); tracing starts at the
  // monorepo root so workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  // No native modules in a client build (one zip runs on Linux, macOS and Windows): images are
  // resized before upload, so Next's sharp-based optimiser is off and sharp is never shipped.
  outputFileTracingExcludes: {
    '*': ['**/node_modules/sharp/**', '**/node_modules/@img/**'],
  },
  productionBrowserSourceMaps: false,
  images: {
    unoptimized: true,
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
