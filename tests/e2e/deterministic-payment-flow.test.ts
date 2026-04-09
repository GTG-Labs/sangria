/**
 * Deterministic Payment Flow E2E Tests
 * Tests complete x402 payment flow with predictable, repeatable behavior
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MockSangriaServer } from '../utils/test-server.js'

let mockServer: MockSangriaServer | null = null
let realFetch: any

describe('Deterministic X402 Payment Flow', () => {
  beforeAll(async () => {
    try {
      // Setup real fetch for E2E tests
      realFetch = globalThis.fetch || ((await import('node-fetch')).default as any)

      // Use deterministic server (no random behavior)
      mockServer = new MockSangriaServer(8083, {
        latency: 0,
        errorRate: 0,
        rateLimitThreshold: null // No rate limiting for deterministic tests
      })

      await mockServer.start()

      // Give the server a moment to fully initialize
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      console.error('Failed to start mock server:', error)
      throw error
    }
  }, 30000)

  afterAll(async () => {
    if (mockServer) {
      await mockServer.stop()
      mockServer = null
    }
  })

  describe('Payment Generation', () => {
    it('should generate payment with consistent structure', async () => {
      const response = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 0.01,
          resource: `${mockServer!.getBaseUrl()}/api/premium`,
          description: 'Deterministic test payment'
        })
      })

      expect(response.status).toBe(200)
      const payment = await response.json()

      // Verify consistent structure (not necessarily deterministic IDs)
      expect(payment.payment_id).toMatch(/^payment_\d+_[a-z0-9]+$/)
      expect(payment.payment_header).toMatch(/^header_\d+_[a-z0-9]+$/)
      expect(payment.amount).toBe(0.01)
      expect(payment.resource).toBe(`${mockServer!.getBaseUrl()}/api/premium`)
      expect(payment.facilitator_url).toBe('https://api.sangria.network')

      // Verify timestamps are reasonable
      expect(payment.timestamp).toBeGreaterThan(Math.floor(Date.now() / 1000) - 10)
      expect(payment.expires_at).toBe(payment.timestamp + 300)
    })

    it('should validate payment generation input strictly', async () => {
      const testCases = [
        {
          input: { amount: 0, resource: `${mockServer!.getBaseUrl()}/api/test` },
          expectedStatus: 400,
          expectedError: 'Invalid amount'
        },
        {
          input: { amount: -0.01, resource: `${mockServer!.getBaseUrl()}/api/test` },
          expectedStatus: 400,
          expectedError: 'Invalid amount'
        },
        {
          input: { amount: 0.01 }, // missing resource
          expectedStatus: 400,
          expectedError: 'Resource URL required'
        }
      ]

      for (const testCase of testCases) {
        const response = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testCase.input)
        })

        expect(response.status).toBe(testCase.expectedStatus)
        const result = await response.json()
        expect(result.error).toBe(testCase.expectedError)
      }
    })

    it('should handle various valid amounts correctly', async () => {
      const testAmounts = [0.000001, 0.01, 1.0, 100.50]

      for (const amount of testAmounts) {
        const response = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount,
            resource: `${mockServer!.getBaseUrl()}/api/test-${amount}`
          })
        })

        expect(response.status).toBe(200)
        const payment = await response.json()
        expect(payment.amount).toBe(amount)
      }
    })
  })
})
