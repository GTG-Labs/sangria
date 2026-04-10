/**
 * Basic integration tests for Sangria TypeScript SDK API contract.
 * Minimal tests to verify core API functionality works.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { Sangria } from '../../../sdk/sdk-typescript/src/core.js'
import type { SangriaConfig, FixedPriceOptions, PaymentContext } from '../../../sdk/sdk-typescript/src/types.js'

// Mock API responses
const mockGenerateResponse = {
  payment_id: 'pay_integration_123',
  amount: 15.00,
  currency: 'USD',
  payment_url: 'https://pay.sangria.net/pay_integration_123'
}

const mockSettleResponse = {
  success: true,
  transaction: 'tx_integration_456',
  amount: 15.00
}

// Minimal MSW handlers
const handlers = [
  http.post('https://api.test-sangria.net/v1/generate-payment', async ({ request }) => {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json() as any
    return HttpResponse.json({
      ...mockGenerateResponse,
      amount: body.amount
    })
  }),

  http.post('https://api.test-sangria.net/v1/settle-payment', async ({ request }) => {
    const body = await request.json() as any

    if (body.payment_payload === 'valid_signature') {
      return HttpResponse.json(mockSettleResponse)
    }

    return HttpResponse.json({
      success: false,
      error_message: 'Invalid signature',
      error_reason: 'invalid_signature'
    })
  })
]

const server = setupServer(...handlers)

describe('Basic API Integration Tests', () => {
  let sangria: Sangria

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
  })

  afterAll(() => {
    server.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    const config: SangriaConfig = {
      apiKey: 'test_api_key_integration',
      baseUrl: 'https://api.test-sangria.net'
    }
    sangria = new Sangria(config)
  })

  it('should generate payment request successfully', async () => {
    const paymentContext: PaymentContext = {
      paymentHeader: undefined,
      resourceUrl: '/premium/article'
    }

    const options: FixedPriceOptions = {
      price: 15.00,
      description: 'Premium content access'
    }

    const result = await sangria.handleFixedPrice(paymentContext, options)

    expect(result.action).toBe('respond')
    if (result.action === 'respond') {
      expect(result.status).toBe(402)
      expect(result.body).toMatchObject({
        payment_id: expect.stringContaining('pay_'),
        amount: 15.00,
        currency: 'USD',
        payment_url: expect.stringMatching(/^https:\/\/pay\.sangria\.net\//)
      })
      expect(result.headers?.['PAYMENT-REQUIRED']).toBeDefined()
    }
  })

  it('should settle payment successfully with valid signature', async () => {
    const paymentContext: PaymentContext = {
      paymentHeader: 'valid_signature',
      resourceUrl: '/premium/content'
    }

    const options: FixedPriceOptions = {
      price: 15.00
    }

    const result = await sangria.handleFixedPrice(paymentContext, options)

    expect(result.action).toBe('proceed')
    if (result.action === 'proceed') {
      expect(result.data.paid).toBe(true)
      expect(result.data.amount).toBe(15.00)
      expect(result.data.transaction).toBe('tx_integration_456')
    }
  })
})