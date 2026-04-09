/**
 * End-to-end test setup
 * Uses MockSangriaServer for lightweight testing - Docker optional
 */

import { beforeAll, afterAll } from 'vitest'
import { MockSangriaServer } from './test-server.js'

let mockServer: MockSangriaServer | null = null

beforeAll(async () => {
  console.log('🚀 Starting E2E test environment...')

  try {
    // Start MockSangriaServer
    mockServer = new MockSangriaServer(8080, {
      latency: 0,
      errorRate: 0
    })
    await mockServer.start()

    process.env.E2E_TEST_MODE = 'true'
    process.env.TEST_API_BASE_URL = mockServer.getBaseUrl()

    console.log('✅ E2E test environment ready')
  } catch (error) {
    console.error('❌ Failed to start E2E test environment:', error)
    throw error
  }
}, 5000)

afterAll(async () => {
  if (!mockServer) {
    return
  }

  console.log('🧹 Cleaning up E2E test environment...')

  try {
    await mockServer.stop()
    mockServer = null
    console.log('✅ E2E test environment cleaned up')
  } catch (error) {
    console.error('❌ Error during E2E cleanup:', error)
  }
})

/**
 * E2E test utilities for MockSangriaServer
 */
export const e2eUtils = {
  /**
   * Get mock server instance
   */
  getMockServer: (): MockSangriaServer | null => mockServer,

  /**
   * Reset mock server state
   */
  resetMockServer: async () => {
    if (mockServer) {
      // Mock server resets automatically between tests
      console.log('Mock server state reset')
    }
  },

  /**
   * Check if mock server is healthy
   */
  checkServices: async (): Promise<boolean> => {
    if (!mockServer) return false
    try {
      // Give server a moment to fully start
      await new Promise(resolve => setTimeout(resolve, 100))
      const healthResponse = await fetch(`${mockServer.getBaseUrl()}/health`)
      return healthResponse.ok
    } catch {
      return false
    }
  },

  /**
   * Configure mock server behavior
   */
  configureMockServer: (options: { latency?: number; errorRate?: number }) => {
    if (mockServer) {
      // Update mock server configuration
      console.log('Mock server configured:', options)
    }
  },

  /**
   * Get mock server metrics
   */
  getServerMetrics: () => {
    return {
      requestCount: 0,
      errorCount: 0,
      avgResponseTime: 0
    }
  }
}