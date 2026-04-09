/**
 * E2E test for complete x402 payment flow
 * Based on playground/e2e_test/client.py but adapted for our test infrastructure
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MockSangriaServer } from '../utils/test-server.js'

// Use real fetch for E2E tests (global setup mocks it)
const realFetch = globalThis.fetch || ((await import('node-fetch')).default as any)

let mockServer: MockSangriaServer | null = null

describe('X402 Payment Flow E2E', () => {
  beforeAll(async () => {
    // Start our own server instead of relying on global setup
    mockServer = new MockSangriaServer(8081, { latency: 0, errorRate: 0 })
    await mockServer.start()
  })

  afterAll(async () => {
    if (mockServer) {
      await mockServer.stop()
      mockServer = null
    }
  })

  it('should complete full x402 payment flow', async () => {
    expect(mockServer).toBeTruthy()

    // Step 1: GET /premium endpoint (expect 402)
    const initialResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/premium`)
    expect(initialResponse.status).toBe(402)

    const paymentRequired = await initialResponse.json()
    expect(paymentRequired.error).toBe('Payment required')

    // Step 2: Generate payment terms
    const paymentResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 0.01,
        resource: `${mockServer!.getBaseUrl()}/api/premium`,
        description: 'E2E test payment'
      })
    })

    expect(paymentResponse.ok).toBe(true)
    const paymentTerms = await paymentResponse.json()

    expect(paymentTerms.payment_id).toBeDefined()
    expect(paymentTerms.payment_header).toBeDefined()
    expect(paymentTerms.amount).toBe(0.01)

    // Step 3: Retry with payment header
    const paidResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/premium`, {
      headers: {
        'x-payment': paymentTerms.payment_header
      }
    })

    expect(paidResponse.status).toBe(200)
    const paidContent = await paidResponse.json()
    expect(paidContent.content).toBe('Premium content')
    expect(paidContent.paid).toBe(true)
  })

  it('should handle payment scenarios', async () => {
    expect(mockServer).toBeTruthy()

    const scenarios = [
      {
        name: 'insufficient funds',
        paymentHeader: 'insufficient_payment_123',
        expectedStatus: 402,
        expectedError: 'Insufficient funds'
      },
      {
        name: 'invalid signature',
        paymentHeader: 'invalid_signature_123',
        expectedStatus: 402,
        expectedError: 'Invalid payment signature'
      },
      {
        name: 'expired payment',
        paymentHeader: 'expired_payment_123',
        expectedStatus: 402,
        expectedError: 'Payment has expired'
      }
    ]

    for (const scenario of scenarios) {
      // Generate payment
      const paymentResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 0.01,
          resource: `${mockServer!.getBaseUrl()}/api/premium`,
          description: `E2E test: ${scenario.name}`
        })
      })

      expect(paymentResponse.ok).toBe(true)

      // Try to settle with scenario-specific header
      const settlementResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-api-key'
        },
        body: JSON.stringify({
          payment_header: scenario.paymentHeader,
          amount: 0.01,
          resource: `${mockServer!.getBaseUrl()}/api/premium`
        })
      })

      expect(settlementResponse.status).toBe(scenario.expectedStatus)

      const result = await settlementResponse.json()
      expect(result.error_message).toBe(scenario.expectedError)
    }
  })

  it('should handle rate limiting', async () => {
    expect(mockServer).toBeTruthy()

    // Create a separate server instance with deterministic rate limiting
    const rateLimitServer = new MockSangriaServer(8082, { rateLimitThreshold: 3 })
    await rateLimitServer.start()

    try {
      // Reset request count
      rateLimitServer.resetRequestCount()

      // Make requests that should succeed (under threshold)
      const successRequests = await Promise.all([
        realFetch(`${rateLimitServer.getBaseUrl()}/api/v1/payments/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: 0.01,
            resource: `${rateLimitServer.getBaseUrl()}/api/premium`,
            description: 'Rate limit test 1'
          })
        }),
        realFetch(`${rateLimitServer.getBaseUrl()}/api/v1/payments/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: 0.01,
            resource: `${rateLimitServer.getBaseUrl()}/api/premium`,
            description: 'Rate limit test 2'
          })
        }),
        realFetch(`${rateLimitServer.getBaseUrl()}/api/v1/payments/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: 0.01,
            resource: `${rateLimitServer.getBaseUrl()}/api/premium`,
            description: 'Rate limit test 3'
          })
        })
      ])

      // All should succeed
      successRequests.forEach(response => {
        expect(response.status).toBe(200)
      })

      // Next request should be rate limited
      const rateLimitedResponse = await realFetch(`${rateLimitServer.getBaseUrl()}/api/v1/payments/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 0.01,
          resource: `${rateLimitServer.getBaseUrl()}/api/premium`,
          description: 'Rate limit test - should be rate limited'
        })
      })

      expect(rateLimitedResponse.status).toBe(429)
      const rateLimitedResult = await rateLimitedResponse.json()
      expect(rateLimitedResult.error).toBe('Rate limit exceeded')

    } finally {
      await rateLimitServer.stop()
    }
  })

  it('should provide merchant balance endpoint', async () => {
    expect(mockServer).toBeTruthy()

    const balanceResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/merchant/balance`)
    expect(balanceResponse.ok).toBe(true)

    const balance = await balanceResponse.json()
    expect(balance.balance).toBeDefined()
    expect(balance.pending).toBeDefined()
    expect(balance.currency).toBe('USDC')
    expect(balance.last_updated).toBeDefined()
  })
})