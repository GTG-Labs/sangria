/**
 * Minimal unit tests for Sangria TypeScript SDK Hono adapter.
 */

import { describe, expect, it, vi, type Mock } from 'vitest'
import { Sangria } from '../../../../sdk/sdk-typescript/src/core.js'
import { fixedPrice } from '../../../../sdk/sdk-typescript/src/adapters/hono.js'
import type { FixedPriceOptions, PaymentResult } from '../../../../sdk/sdk-typescript/src/types.js'

// Mock Hono types
interface MockHonoContext {
  req: {
    header: Mock
    url: string
  }
  json: Mock
  status: Mock
  header: Mock
  set: Mock
}

describe('Hono Adapter', () => {
  it('should respond with 402 when payment required', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockContext: MockHonoContext = {
      req: {
        header: vi.fn().mockReturnValue(undefined),
        url: 'https://api.example.com/premium/article'
      },
      json: vi.fn(),
      status: vi.fn(),
      header: vi.fn(),
      set: vi.fn()
    }

    const paymentResult: PaymentResult = {
      action: 'respond',
      status: 402,
      body: {
        payment_id: 'pay_123',
        amount: 15.00,
        payment_url: 'https://pay.sangria.net/pay_123'
      },
      headers: {
        'PAYMENT-REQUIRED': 'base64_encoded_payload'
      }
    }

    ;(mockSangria.handleFixedPrice as Mock).mockResolvedValue(paymentResult)

    const options: FixedPriceOptions = { price: 15.00 }
    const middleware = fixedPrice(mockSangria, options)

    const result = await middleware(mockContext as any, vi.fn())

    expect(mockContext.header).toHaveBeenCalledWith('PAYMENT-REQUIRED', 'base64_encoded_payload')
    expect(mockContext.json).toHaveBeenCalledWith(paymentResult.body, 402)
  })

  it('should proceed when payment verified', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockNext = vi.fn()
    const mockContext: MockHonoContext = {
      req: {
        header: vi.fn().mockReturnValue('valid_signature'),
        url: 'https://api.example.com/premium'
      },
      json: vi.fn(),
      status: vi.fn(),
      header: vi.fn(),
      set: vi.fn()
    }

    const proceedResult: PaymentResult = {
      action: 'proceed',
      data: {
        paid: true,
        amount: 20.00,
        transaction: 'tx_abc123'
      }
    }

    ;(mockSangria.handleFixedPrice as Mock).mockResolvedValue(proceedResult)

    const options: FixedPriceOptions = { price: 20.00 }
    const middleware = fixedPrice(mockSangria, options)

    await middleware(mockContext as any, mockNext)

    expect(mockContext.set).toHaveBeenCalledWith('sangria', proceedResult.data)
    expect(mockNext).toHaveBeenCalled()
    expect(mockContext.json).not.toHaveBeenCalled()
  })

  it('should handle errors gracefully', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockContext: MockHonoContext = {
      req: {
        header: vi.fn().mockReturnValue(undefined),
        url: 'https://api.example.com/test'
      },
      json: vi.fn(),
      status: vi.fn(),
      header: vi.fn(),
      set: vi.fn()
    }

    ;(mockSangria.handleFixedPrice as Mock).mockRejectedValue(new Error('Network error'))

    const options: FixedPriceOptions = { price: 10.00 }
    const middleware = fixedPrice(mockSangria, options)

    try {
      await middleware(mockContext as any, vi.fn())
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Network error')
    }
  })
})