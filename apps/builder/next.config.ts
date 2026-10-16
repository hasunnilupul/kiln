import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

// turbopack.root is left to Next.js, which detects the workspace root from pnpm-lock.yaml.
const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
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
