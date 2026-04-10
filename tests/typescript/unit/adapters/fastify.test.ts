/**
 * Minimal unit tests for Sangria TypeScript SDK Fastify adapter.
 */

import { describe, expect, it, vi, type Mock } from 'vitest'
import { Sangria } from '../../../../sdk/sdk-typescript/src/core.js'
import { fixedPrice } from '../../../../sdk/sdk-typescript/src/adapters/fastify.js'
import type { FixedPriceOptions, PaymentResult } from '../../../../sdk/sdk-typescript/src/types.js'

// Mock Fastify types
interface MockFastifyRequest {
  headers: Record<string, string | string[] | undefined>
  protocol: string
  hostname: string
  url: string
  sangria?: any
}

interface MockFastifyReply {
  status: Mock
  send: Mock
  headers: Mock
}

describe('Fastify Adapter', () => {
  it('should respond with 402 when payment required', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockRequest: MockFastifyRequest = {
      headers: {},
      protocol: 'https',
      hostname: 'api.example.com',
      url: '/premium/content'
    }

    const mockReply: MockFastifyReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      headers: vi.fn().mockReturnThis()
    }

    const paymentResult: PaymentResult = {
      action: 'respond',
      status: 402,
      body: {
        payment_id: 'pay_456',
        amount: 12.50,
        payment_url: 'https://pay.sangria.net/pay_456'
      },
      headers: {
        'PAYMENT-REQUIRED': 'base64_encoded_data'
      }
    }

    ;(mockSangria.handleFixedPrice as Mock).mockResolvedValue(paymentResult)

    const options: FixedPriceOptions = { price: 12.50 }
    const preHandler = fixedPrice(mockSangria, options)

    await preHandler(mockRequest as any, mockReply as any)

    expect(mockReply.status).toHaveBeenCalledWith(402)
    expect(mockReply.headers).toHaveBeenCalledWith({
      'PAYMENT-REQUIRED': 'base64_encoded_data'
    })
    expect(mockReply.send).toHaveBeenCalledWith(paymentResult.body)
  })

  it('should proceed when payment verified', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockRequest: MockFastifyRequest = {
      headers: { 'payment-signature': 'valid_test_signature' },
      protocol: 'https',
      hostname: 'api.example.com',
      url: '/api/premium'
    }

    const mockReply: MockFastifyReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      headers: vi.fn().mockReturnThis()
    }

    const proceedResult: PaymentResult = {
      action: 'proceed',
      data: {
        paid: true,
        amount: 25.00,
        transaction: 'tx_fastify_123'
      }
    }

    ;(mockSangria.handleFixedPrice as Mock).mockResolvedValue(proceedResult)

    const options: FixedPriceOptions = { price: 25.00 }
    const preHandler = fixedPrice(mockSangria, options)

    await preHandler(mockRequest as any, mockReply as any)

    expect(mockRequest.sangria).toEqual(proceedResult.data)
    expect(mockReply.status).not.toHaveBeenCalled()
    expect(mockReply.send).not.toHaveBeenCalled()
  })

  it('should handle errors gracefully', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockRequest: MockFastifyRequest = {
      headers: {},
      protocol: 'https',
      hostname: 'api.example.com',
      url: '/error-test'
    }

    const mockReply: MockFastifyReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      headers: vi.fn().mockReturnThis()
    }

    ;(mockSangria.handleFixedPrice as Mock).mockRejectedValue(new Error('Service error'))

    const options: FixedPriceOptions = { price: 8.00 }
    const preHandler = fixedPrice(mockSangria, options)

    try {
      await preHandler(mockRequest as any, mockReply as any)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Service error')
    }
  })
})