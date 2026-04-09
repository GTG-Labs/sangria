import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Test configuration for Sangria comprehensive test suite
    setupFiles: ['./utils/vitest-setup.ts'],
    environment: 'node',
    reporters: ['verbose'],
    globals: true,
    // Increase timeouts for financial tests that need precision
    testTimeout: 10000,
    hookTimeout: 30000,
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.{ts,js}',
        '**/*.config.{ts,js}',
        'fixtures/**',
        'utils/test-*.{ts,js}'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    // Test file patterns
    include: ['**/*.{test,spec}.{js,ts}'],
    exclude: [
      'node_modules/**',
      'dist/**'
    ]
  }
})