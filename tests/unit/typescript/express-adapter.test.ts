/**
 * TypeScript Express Adapter Tests
 * Tests fixedPrice middleware with comprehensive framework integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fixedPrice } from '../../../sdk/sdk-typescript/src/adapters/express.js'
import { Sangria } from '../../../sdk/sdk-typescript/src/core.js'
import type { Request, Response, NextFunction } from 'express'
import type { SangriaConfig, FixedPriceOptions } from '../../../sdk/sdk-typescript/src/types.js'

describe('Express Adapter', () => {
  let mockSangria: Sangria
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    // Create mock Sangria instance
    const config: SangriaConfig = { apiKey: 'test-key' }
    mockSangria = new Sangria(config)

    // Mock the handleFixedPrice method
    vi.spyOn(mockSangria, 'handleFixedPrice')

    // Create mock Express objects
    mockReq = {
      headers: {},
      protocol: 'https',
      get: vi.fn((header: string) => {
        if (header === 'host') return 'api.example.com'
        return undefined
      }),
      originalUrl: '/api/premium'
    }

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis()
    }

    mockNext = vi.fn()
  })

  describe('Payment Generation Flow', () => {
    it('should generate payment when no payment header provided', async () => {
      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: { payment_id: 'test_payment', challenge: 'test_challenge' },
        headers: { 'PAYMENT-REQUIRED': 'encoded_payload' }
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01, description: 'Test payment' })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should not call next() - responds immediately
      expect(mockNext).not.toHaveBeenCalled()

      // Should set headers and respond with 402
      expect(mockRes.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', 'encoded_payload')
      expect(mockRes.status).toHaveBeenCalledWith(402)
      expect(mockRes.json).toHaveBeenCalledWith({
        payment_id: 'test_payment',
        challenge: 'test_challenge'
      })

      // Verify handleFixedPrice was called with correct parameters
      expect(mockSangria.handleFixedPrice).toHaveBeenCalledWith(
        {
          paymentHeader: undefined,
          resourceUrl: 'https://api.example.com/api/premium'
        },
        {
          price: 0.01,
          description: 'Test payment'
        }
      )
    })

    it('should handle multiple headers correctly', async () => {
      mockReq.headers = {
        'payment-signature': ['signature1', 'signature2'] // Multiple headers (Express array format)
      }

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: {},
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should use first header when multiple are provided
      const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
      expect(callArgs[0].paymentHeader).toBe('signature1')
    })

    it('should construct resource URL correctly', async () => {
      mockReq.protocol = 'http'
      mockReq.originalUrl = '/api/premium?param=value'
      ;(mockReq.get as any).mockImplementation((header: string) => {
        if (header === 'host') return 'localhost:3000'
        return undefined
      })

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: {},
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
      expect(callArgs[0].resourceUrl).toBe('http://localhost:3000/api/premium?param=value')
    })
  })

  describe('Payment Settlement Flow', () => {
    it('should settle payment when payment header provided', async () => {
      mockReq.headers = {
        'payment-signature': 'valid_signature'
      }

      const mockSettlementResponse = {
        action: 'proceed' as const,
        data: {
          paid: true,
          amount: 0.01,
          transaction: 'tx_abc123'
        }
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockSettlementResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should call next() to continue to route handler
      expect(mockNext).toHaveBeenCalledOnce()

      // Should attach payment data to request
      expect(mockReq.sangria).toEqual({
        paid: true,
        amount: 0.01,
        transaction: 'tx_abc123'
      })

      // Should not respond directly
      expect(mockRes.status).not.toHaveBeenCalled()
      expect(mockRes.json).not.toHaveBeenCalled()

      // Verify handleFixedPrice was called with payment header
      const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
      expect(callArgs[0].paymentHeader).toBe('valid_signature')
    })

    it('should handle settlement failure', async () => {
      mockReq.headers = {
        'payment-signature': 'invalid_signature'
      }

      const mockFailureResponse = {
        action: 'respond' as const,
        status: 402,
        body: {
          error: 'Payment failed',
          error_reason: 'INVALID_SIGNATURE'
        },
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockFailureResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should respond with error, not call next()
      expect(mockNext).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(402)
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Payment failed',
        error_reason: 'INVALID_SIGNATURE'
      })
    })
  })

  describe('Bypass Payment Configuration', () => {
    it('should bypass payment when condition is met', async () => {
      mockReq.headers = {
        'x-api-key': 'admin_key'
      }

      const bypassCondition = (req: Request) => req.headers['x-api-key'] === 'admin_key'

      const middleware = fixedPrice(
        mockSangria,
        { price: 0.01 },
        { bypassPaymentIf: bypassCondition }
      )

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should bypass payment and call next()
      expect(mockNext).toHaveBeenCalledOnce()

      // Should set default payment data
      expect(mockReq.sangria).toEqual({
        paid: false,
        amount: 0
      })

      // Should not call Sangria
      expect(mockSangria.handleFixedPrice).not.toHaveBeenCalled()
    })

    it('should not bypass payment when condition is not met', async () => {
      mockReq.headers = {
        'x-api-key': 'user_key'
      }

      const bypassCondition = (req: Request) => req.headers['x-api-key'] === 'admin_key'

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: { payment_id: 'test' },
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(
        mockSangria,
        { price: 0.01 },
        { bypassPaymentIf: bypassCondition }
      )

      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should require payment (not bypass)
      expect(mockNext).not.toHaveBeenCalled()
      expect(mockSangria.handleFixedPrice).toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(402)
    })

    it('should handle bypass condition throwing error', async () => {
      const bypassCondition = (req: Request) => {
        throw new Error('Bypass condition error')
      }

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: {},
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(
        mockSangria,
        { price: 0.01 },
        { bypassPaymentIf: bypassCondition }
      )

      // Should propagate the error
      await expect(
        middleware(mockReq as Request, mockRes as Response, mockNext)
      ).rejects.toThrow('Bypass condition error')
    })
  })

  describe('Header Handling', () => {
    it('should handle missing payment-signature header', async () => {
      mockReq.headers = {}

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: {},
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
      expect(callArgs[0].paymentHeader).toBeUndefined()
    })

    it('should handle empty string payment header', async () => {
      mockReq.headers = {
        'payment-signature': ''
      }

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: {},
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
      expect(callArgs[0].paymentHeader).toBe('')
    })

    it('should set multiple response headers correctly', async () => {
      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: {},
        headers: {
          'PAYMENT-REQUIRED': 'encoded_payload',
          'X-Custom-Header': 'custom_value',
          'Cache-Control': 'no-cache'
        }
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.setHeader).toHaveBeenCalledWith('PAYMENT-REQUIRED', 'encoded_payload')
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Custom-Header', 'custom_value')
      expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache')
    })

    it('should handle response without headers', async () => {
      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: { payment_id: 'test' }
        // No headers property
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should not call setHeader when no headers provided
      expect(mockRes.setHeader).not.toHaveBeenCalled()
      expect(mockRes.status).toHaveBeenCalledWith(402)
      expect(mockRes.json).toHaveBeenCalledWith({ payment_id: 'test' })
    })
  })

  describe('Price Validation', () => {
    it('should handle various valid price formats', async () => {
      const validPrices = [0.01, 1, 0.000001, 999.99, 1e-6, 1e6]

      for (const price of validPrices) {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const middleware = fixedPrice(mockSangria, { price })
        await middleware(mockReq as Request, mockRes as Response, mockNext)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[1].price).toBe(price)

        // Reset mocks for next iteration
        vi.clearAllMocks()
        ;(mockSangria.handleFixedPrice as any).mockClear()
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle Sangria errors gracefully', async () => {
      ;(mockSangria.handleFixedPrice as any).mockRejectedValue(new Error('Service unavailable'))

      const middleware = fixedPrice(mockSangria, { price: 0.01 })

      // Should propagate the error (middleware doesn't catch Sangria errors)
      await expect(
        middleware(mockReq as Request, mockRes as Response, mockNext)
      ).rejects.toThrow('Service unavailable')
    })

    it('should handle missing host header', async () => {
      ;(mockReq.get as any).mockImplementation((header: string) => {
        if (header === 'host') return undefined
        return undefined
      })

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: {},
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      // Should construct URL with undefined host (handled by underlying logic)
      const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
      expect(callArgs[0].resourceUrl).toBe('https://undefined/api/premium')
    })
  })

  describe('Request Data Attachment', () => {
    it('should correctly attach payment data to request object', async () => {
      const mockPaymentData = {
        paid: true,
        amount: 1.50,
        transaction: 'tx_def456'
      }

      const mockSettlementResponse = {
        action: 'proceed' as const,
        data: mockPaymentData
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockSettlementResponse)

      const middleware = fixedPrice(mockSangria, { price: 1.50 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockReq.sangria).toEqual(mockPaymentData)
    })

    it('should handle payment data with missing transaction', async () => {
      const mockPaymentData = {
        paid: true,
        amount: 0.50
        // No transaction field
      }

      const mockSettlementResponse = {
        action: 'proceed' as const,
        data: mockPaymentData
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockSettlementResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.50 })
      await middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockReq.sangria).toEqual({
        paid: true,
        amount: 0.50
      })
    })
  })

  describe('Concurrent Requests', () => {
    it('should handle concurrent middleware executions', async () => {
      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: { payment_id: 'concurrent_test' },
        headers: {}
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      const middleware = fixedPrice(mockSangria, { price: 0.01 })

      // Create multiple requests
      const requests = Array.from({ length: 5 }, (_, i) => ({
        ...mockReq,
        originalUrl: `/api/premium/${i}`
      }))

      const responses = Array.from({ length: 5 }, () => ({ ...mockRes }))
      const nextFunctions = Array.from({ length: 5 }, () => vi.fn())

      // Execute concurrent middleware calls
      const promises = requests.map((req, i) =>
        middleware(req as Request, responses[i] as Response, nextFunctions[i])
      )

      await Promise.all(promises)

      // All should have been processed
      expect(mockSangria.handleFixedPrice).toHaveBeenCalledTimes(5)

      // All should have responded with 402
      responses.forEach(res => {
        expect(res.status).toHaveBeenCalledWith(402)
      })
    })
  })
})