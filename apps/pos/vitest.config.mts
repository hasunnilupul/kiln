import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    // Payload runs in Node; jsdom breaks binary checks such as upload type detection.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts', 'tests/unit/**/*.test.ts'],
    // Integration tests share one database; parallel files race on schema push and fixtures.
    fileParallelism: false,
  },
})
