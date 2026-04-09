/**
 * Global Vitest setup for all test types
 * Configures test environment, mocks, and utilities
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'

// Global test configuration
beforeAll(async () => {
  console.log('🧪 Initializing Sangria SDK test suite...')

  // Set test environment variables
  process.env.NODE_ENV = 'test'
  process.env.TEST_MODE = 'true'

  // Configure global timeouts
  vi.setConfig({ testTimeout: 30000 })

  // Initialize global mocks - skip for E2E, performance, and cross-SDK tests
  const testPath = expect.getState().testPath
  const isE2ETest = testPath?.includes('e2e/')
  const isPerformanceTest = testPath?.includes('performance/')
  const isCrossSDKTest = testPath?.includes('cross-sdk/')
  if (!isE2ETest && !isPerformanceTest && !isCrossSDKTest) {
    setupGlobalMocks()
  }

  console.log('✅ Test suite initialized')
})

afterAll(async () => {
  console.log('🧹 Cleaning up test suite...')

  // Cleanup global resources
  await cleanupGlobalResources()

  console.log('✅ Test suite cleanup completed')
})

beforeEach(async () => {
  // Reset all mocks before each test
  vi.clearAllMocks()
  vi.clearAllTimers()

  // Removed buffer that was causing timing issues
})

afterEach(() => {
  // Restore all mocks after each test
  vi.restoreAllMocks()
})

/**
 * Setup global mocks for testing
 */
function setupGlobalMocks() {
  // Mock fetch globally
  global.fetch = vi.fn()

  // Mock console methods to reduce noise in tests (but preserve for debugging)
  const originalConsole = { ...console }
  console.warn = vi.fn()
  // Keep console.log and console.error for debugging

  // Mock timers
  vi.useFakeTimers()

  // Mock crypto for Node.js environments
  if (!global.crypto) {
    global.crypto = {
      randomUUID: vi.fn(() => 'mock-uuid-1234'),
      // Add other crypto methods as needed
    } as any
  }
}

/**
 * Cleanup global resources
 */
async function cleanupGlobalResources() {
  // Reset timers
  vi.useRealTimers()

  // Clear any pending operations
  if (global.fetch) {
    vi.clearAllMocks()
  }

  // Force garbage collection if available
  if (global.gc) {
    global.gc()
  }
}

/**
 * Global test utilities
 */
export const testUtils = {
  /**
   * Wait for a specified amount of time
   */
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Create a mock response for fetch
   */
  mockResponse: (data: any, options: { status?: number; ok?: boolean } = {}) => ({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  }),

  /**
   * Generate random test data
   */
  randomId: () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  randomPrice: () => Math.round(Math.random() * 100 * 100) / 100, // 0.01 to 100.00
  randomUrl: () => `https://example-${Math.random().toString(36).substr(2, 5)}.com/resource`,

  /**
   * Assert that a value is defined (TypeScript helper)
   */
  assertDefined: <T>(value: T | undefined | null): asserts value is T => {
    if (value === undefined || value === null) {
      throw new Error('Expected value to be defined')
    }
  }
}

// Make test utilities available globally
;(global as any).testUtils = testUtils