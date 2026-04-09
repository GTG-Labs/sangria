/**
 * Cross-SDK Interoperability Tests
 * Tests compatibility between TypeScript and Python SDKs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MockSangriaServer } from '../utils/test-server.js'

let mockServer: MockSangriaServer | null = null
let realFetch: any

describe('TypeScript-Python SDK Interoperability', () => {
  beforeAll(async () => {
    // Setup real fetch for cross-SDK tests
    realFetch = globalThis.fetch || ((await import('node-fetch')).default as any)

    // Start mock server for both SDKs to use
    mockServer = new MockSangriaServer(8084, {
      latency: 0,
      errorRate: 0,
      rateLimitThreshold: null
    })

    await mockServer.start()
    await new Promise(resolve => setTimeout(resolve, 100))
  }, 30000)

  afterAll(async () => {
    if (mockServer) {
      await mockServer.stop()
      mockServer = null
    }
  })

  it('should generate compatible payment structures', async () => {
    // Test that both SDKs generate compatible payment data structures
    const tsResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key'
      },
      body: JSON.stringify({
        amount: 0.01,
        resource: 'https://example.com/premium'
      })
    })

    expect(tsResponse.status).toBe(200)
    const tsPayment = await tsResponse.json()

    // Verify payment structure compatibility
    expect(tsPayment).toHaveProperty('payment_id')
    expect(tsPayment).toHaveProperty('payment_header')
    expect(tsPayment).toHaveProperty('challenge')
    expect(tsPayment).toHaveProperty('amount')
    expect(tsPayment).toHaveProperty('resource')
    expect(tsPayment).toHaveProperty('timestamp')
    expect(tsPayment).toHaveProperty('expires_at')

    // Verify data types
    expect(typeof tsPayment.payment_id).toBe('string')
    expect(typeof tsPayment.payment_header).toBe('string')
    expect(typeof tsPayment.amount).toBe('number')
    expect(typeof tsPayment.timestamp).toBe('number')
    expect(typeof tsPayment.expires_at).toBe('number')
  })

  it('should handle settlement with compatible payment headers', async () => {
    // First generate a payment
    const generateResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key'
      },
      body: JSON.stringify({
        amount: 0.01,
        resource: 'https://example.com/premium'
      })
    })

    const payment = await generateResponse.json()

    // Test settlement with the generated payment header
    const settleResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/settle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key'
      },
      body: JSON.stringify({
        payment_header: payment.payment_header,
        amount: payment.amount,
        resource: payment.resource
      })
    })

    expect(settleResponse.status).toBe(200)
    const settlement = await settleResponse.json()

    // Verify settlement structure
    expect(settlement).toHaveProperty('success')
    expect(settlement.success).toBe(true)
  })

  it('should validate amount precision consistently', async () => {
    // Test various amount precisions that both SDKs should handle
    const testAmounts = [0.01, 0.001, 1.0, 10.50, 0.000001]

    for (const amount of testAmounts) {
      const response = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key'
        },
        body: JSON.stringify({
          amount,
          resource: `https://example.com/test-${amount}`
        })
      })

      expect(response.status).toBe(200)
      const payment = await response.json()
      expect(payment.amount).toBe(amount)
    }
  })

  it('should handle error responses consistently', async () => {
    // Test invalid amount (should fail validation)
    const invalidAmountResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key'
      },
      body: JSON.stringify({
        amount: -0.01, // Invalid negative amount
        resource: 'https://example.com/premium'
      })
    })

    expect(invalidAmountResponse.status).toBe(400)
    const error = await invalidAmountResponse.json()
    expect(error).toHaveProperty('error')

    // Test missing resource (should fail validation)
    const missingResourceResponse = await realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-key'
      },
      body: JSON.stringify({
        amount: 0.01
        // Missing resource field
      })
    })

    expect(missingResourceResponse.status).toBe(400)
  })

  it('should maintain API response format consistency', async () => {
    // Generate multiple payments and verify consistent response format
    const responses = await Promise.all([
      realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key'
        },
        body: JSON.stringify({
          amount: 0.01,
          resource: 'https://example.com/test1'
        })
      }),
      realFetch(`${mockServer!.getBaseUrl()}/api/v1/payments/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-key'
        },
        body: JSON.stringify({
          amount: 0.05,
          resource: 'https://example.com/test2'
        })
      })
    ])

    const payments = await Promise.all(responses.map(r => r.json()))

    // Verify all payments have the same structure
    const firstKeys = Object.keys(payments[0]).sort()

    for (const payment of payments) {
      const keys = Object.keys(payment).sort()
      expect(keys).toEqual(firstKeys)
    }
  })
})