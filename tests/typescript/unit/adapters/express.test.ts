/**
 * Minimal unit tests for Sangria TypeScript SDK Express adapter.
 */

import { describe, expect, it, vi, type Mock } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { Sangria } from '../../../../sdk/sdk-typescript/src/core.js'
import { fixedPrice } from '../../../../sdk/sdk-typescript/src/adapters/express.js'
import type { FixedPriceOptions, PaymentResult } from '../../../../sdk/sdk-typescript/src/types.js'

// Mock Express types
interface MockRequest extends Partial<Request> {
  headers: Record<string, string | string[] | undefined>
  protocol: string
  hostname: string
  originalUrl: string
  sangria?: any
}

interface MockResponse extends Partial<Response> {
  status: Mock
  json: Mock
  setHeader: Mock
}

describe('Express Adapter', () => {
  it('should respond with 402 when payment required', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockRequest: MockRequest = {
      headers: {},
      protocol: 'https',
      hostname: 'api.example.com',
      originalUrl: '/premium/article/123'
    }

    const mockResponse: MockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    }

    const mockNext = vi.fn()

    const paymentResult: PaymentResult = {
      action: 'respond',
      status: 402,
      body: {
        payment_id: 'pay_123',
        amount: 10.00,
        payment_url: 'https://pay.sangria.net/pay_123'
      },
      headers: {
        'PAYMENT-REQUIRED': 'base64_encoded_payload'
      }
    }

    ;(mockSangria.handleFixedPrice as Mock).mockResolvedValue(paymentResult)

    const options: FixedPriceOptions = { price: 10.00 }
    const middleware = fixedPrice(mockSangria, options)

    await middleware(mockRequest as Request, mockResponse as Response, mockNext)

    expect(mockResponse.status).toHaveBeenCalledWith(402)
    expect(mockResponse.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', 'base64_encoded_payload')
    expect(mockResponse.json).toHaveBeenCalledWith(paymentResult.body)
    expect(mockNext).not.toHaveBeenCalled()
  })

  it('should proceed when payment verified', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockRequest: MockRequest = {
      headers: { 'payment-signature': 'valid_signature' },
      protocol: 'https',
      hostname: 'api.example.com',
      originalUrl: '/premium/content'
    }

    const mockResponse: MockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    }

    const mockNext = vi.fn()

    const proceedResult: PaymentResult = {
      action: 'proceed',
      data: {
        paid: true,
        amount: 25.00,
        transaction: 'tx_abc123'
      }
    }

    ;(mockSangria.handleFixedPrice as Mock).mockResolvedValue(proceedResult)

    const options: FixedPriceOptions = { price: 25.00 }
    const middleware = fixedPrice(mockSangria, options)

    await middleware(mockRequest as Request, mockResponse as Response, mockNext)

    expect(mockRequest.sangria).toEqual(proceedResult.data)
    expect(mockNext).toHaveBeenCalled()
    expect(mockResponse.status).not.toHaveBeenCalled()
    expect(mockResponse.json).not.toHaveBeenCalled()
  })

  it('should handle errors gracefully', async () => {
    const mockSangria = {
      handleFixedPrice: vi.fn()
    } as any as Sangria

    const mockRequest: MockRequest = {
      headers: {},
      protocol: 'https',
      hostname: 'api.example.com',
      originalUrl: '/error-test'
    }

    const mockResponse: MockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn()
    }

    const mockNext = vi.fn()

    ;(mockSangria.handleFixedPrice as Mock).mockRejectedValue(new Error('Service error'))

    const options: FixedPriceOptions = { price: 5.00 }
    const middleware = fixedPrice(mockSangria, options)

    try {
      await middleware(mockRequest as Request, mockResponse as Response, mockNext)
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Service error')
    }
  })
})