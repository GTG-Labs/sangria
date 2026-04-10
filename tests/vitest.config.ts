import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./typescript/setup/vitest-setup.ts'],
    include: ['typescript/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'tests/**',
        '**/node_modules/**',
        '**/dist/**'
      ]
    },
    testTimeout: 10000,
    hookTimeout: 10000
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../sdk/sdk-typescript/src'),
      '@tests': resolve(__dirname, './typescript')
    }
  },
  esbuild: {
    target: 'node18'
  }
})