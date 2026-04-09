/**
 * Deterministic E2E test setup
 * Replaces non-deterministic MockServer with predictable test environment
 */

import { beforeAll, afterAll } from 'vitest'
import { DeterministicSangriaServer } from './deterministic-server.js'

let deterministicServer: DeterministicSangriaServer | null = null

beforeAll(async () => {
  console.log('🚀 Starting deterministic E2E test environment...')

  try {
    // Start deterministic server
    deterministicServer = new DeterministicSangriaServer(8081, { // Different port to avoid conflict
      enableRateLimit: true,
      enableAuth: true,
      enableSignatureValidation: true
    })

    await deterministicServer.start()

    process.env.E2E_TEST_MODE = 'deterministic'
    process.env.TEST_API_BASE_URL = deterministicServer.getBaseUrl()

    console.log('✅ Deterministic E2E test environment ready')
  } catch (error) {
    console.error('❌ Failed to start deterministic test environment:', error)
    throw error
  }
}, 30000)

afterAll(async () => {
  if (!deterministicServer) {
    return
  }

  console.log('🧹 Cleaning up deterministic test environment...')

  try {
    await deterministicServer.stop()
    deterministicServer = null
    console.log('✅ Deterministic test environment cleaned up')
  } catch (error) {
    console.error('❌ Error during cleanup:', error)
  }
})

/**
 * Deterministic test utilities
 */
export const deterministicUtils = {
  /**
   * Get deterministic server instance
   */
  getServer: (): DeterministicSangriaServer | null => deterministicServer,

  /**
   * Reset server state between tests
   */
  resetState: () => {
    if (deterministicServer) {
      deterministicServer.resetState()
      console.log('🔄 Server state reset')
    }
  },

  /**
   * Check if server is healthy
   */
  checkHealth: async (): Promise<boolean> => {
    if (!deterministicServer) return false

    try {
      const response = await fetch(`${deterministicServer.getBaseUrl()}/health`)
      return response.ok
    } catch {
      return false
    }
  },

  /**
   * Get server state for testing/debugging
   */
  getState: () => {
    return deterministicServer?.getState() || null
  },

  /**
   * Set wallet balance for testing
   */
  setBalance: (address: string, balance: string) => {
    if (deterministicServer) {
      deterministicServer.setBalance(address, balance)
    }
  },

  /**
   * Add used nonce for testing replay scenarios
   */
  addUsedNonce: (nonce: string) => {
    if (deterministicServer) {
      deterministicServer.addUsedNonce(nonce)
    }
  },

  /**
   * Get deterministic test wallets
   */
  getTestWallets: () => ({
    rich: {
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      balance: '1000000000' // 1000 USDC
    },
    medium: {
      address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      balance: '500000000' // 500 USDC
    },
    poor: {
      address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      balance: '100000000' // 100 USDC
    },
    empty: {
      address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
      privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
      balance: '0' // 0 USDC
    }
  }),

  /**
   * Generate deterministic payment data for testing
   */
  generatePaymentData: (
    from: string,
    to: string = '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
    amount: string = '0.01',
    testId: string = 'default'
  ) => {
    const now = Math.floor(Date.now() / 1000)
    return {
      from,
      to,
      value: (BigInt(Math.floor(parseFloat(amount) * 1000000))).toString(), // Convert to USDC base units
      validAfter: now,
      validBefore: now + 300, // 5 minutes
      nonce: `0x${Buffer.from(`test-${testId}-${Date.now()}`).toString('hex').padStart(64, '0')}`
    }
  },

  /**
   * Wait for server to be ready
   */
  waitForReady: async (timeoutMs: number = 5000): Promise<boolean> => {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
      if (await deterministicUtils.checkHealth()) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return false
  }
}