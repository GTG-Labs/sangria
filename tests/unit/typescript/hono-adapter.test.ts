/**
 * TypeScript Hono Adapter Tests
 * Tests fixedPrice middleware and getSangria utility with comprehensive framework integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fixedPrice, getSangria } from '../../../sdk/sdk-typescript/src/adapters/hono.js'
import { Sangria } from '../../../sdk/sdk-typescript/src/core.js'
import type { SangriaConfig } from '../../../sdk/sdk-typescript/src/types.js'

// Mock Hono context and types
interface MockHonoContext {
  req: {
    url: string
    header: (name: string) => string | undefined
  }
  set: (key: string, value: any) => void
  get: (key: string) => any
  json: (object: any, init?: any) => any
  header: (key: string, value: string) => void
  variables: Record<string, any>
}

describe('Hono Adapter', () => {
  let mockSangria: Sangria
  let mockContext: MockHonoContext
  let mockNext: () => Promise<void>

  beforeEach(() => {
    // Create mock Sangria instance
    const config: SangriaConfig = { apiKey: 'test-key' }
    mockSangria = new Sangria(config)

    // Mock the handleFixedPrice method
    vi.spyOn(mockSangria, 'handleFixedPrice')

    // Create mock Hono context
    mockContext = {
      req: {
        url: 'https://api.example.com/api/premium',
        header: vi.fn((name: string) => {
          if (name === 'payment-signature') return undefined
          return undefined
        })
      },
      set: vi.fn(),
      get: vi.fn(),
      json: vi.fn(),
      header: vi.fn(),
      variables: {}
    }

    mockNext = vi.fn().mockResolvedValue(undefined)
  })

  describe('fixedPrice Middleware', () => {
    describe('Payment Generation Flow', () => {
      it('should generate payment when no payment header provided', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: { payment_id: 'test_payment', challenge: 'test_challenge' },
          headers: { 'PAYMENT-REQUIRED': 'encoded_payload' }
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const middleware = fixedPrice(mockSangria, {
          price: 0.01,
          description: 'Test payment'
        })

        const result = await middleware(mockContext as any, mockNext)

        // Should return JSON response (not call next)
        expect(mockNext).not.toHaveBeenCalled()
        expect(mockContext.header).toHaveBeenCalledWith('PAYMENT-REQUIRED', 'encoded_payload')
        expect(mockContext.json).toHaveBeenCalledWith(
          { payment_id: 'test_payment', challenge: 'test_challenge' },
          402
        )

        // Verify URL parsing and resource extraction
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

      it('should parse complex URLs correctly', async () => {
        mockContext.req.url = 'https://api.example.com/api/premium?param=value&other=test#fragment'

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const middleware = fixedPrice(mockSangria, { price: 0.01 })
        await middleware(mockContext as any, mockNext)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].resourceUrl).toBe('https://api.example.com/api/premium?param=value&other=test')
      })

      it('should handle URL parsing edge cases', async () => {
        const testUrls = [
          'http://localhost:3000/api',
          'https://subdomain.example.com/path',
          'https://api.com/café/unicode',
          'https://api.com/api?empty=&filled=value',
          'https://api.com:8080/api'
        ]

        for (const url of testUrls) {
          mockContext.req.url = url

          const mockPaymentResponse = {
            action: 'respond' as const,
            status: 402,
            body: {},
            headers: {}
          }

          ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

          const middleware = fixedPrice(mockSangria, { price: 0.01 })
          await middleware(mockContext as any, mockNext)

          const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
          const parsedUrl = new URL(url)
          const expectedResourceUrl = parsedUrl.origin + parsedUrl.pathname + parsedUrl.search

          expect(callArgs[0].resourceUrl).toBe(expectedResourceUrl)

          // Reset for next iteration
          ;(mockSangria.handleFixedPrice as any).mockClear()
        }
      })

      it('should handle malformed URLs gracefully', async () => {
        mockContext.req.url = 'not-a-valid-url'

        const middleware = fixedPrice(mockSangria, { price: 0.01 })

        // Should handle URL parsing errors gracefully
        await expect(
          middleware(mockContext as any, mockNext)
        ).rejects.toThrow()
      })
    })

    describe('Payment Settlement Flow', () => {
      it('should settle payment when payment header provided', async () => {
        ;(mockContext.req.header as any).mockImplementation((name: string) => {
          if (name === 'payment-signature') return 'valid_signature'
          return undefined
        })

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
        const result = await middleware(mockContext as any, mockNext)

        // Should call next() to continue to route handler
        expect(mockNext).toHaveBeenCalledOnce()

        // Should set payment data in context
        expect(mockContext.set).toHaveBeenCalledWith('sangria', {
          paid: true,
          amount: 0.01,
          transaction: 'tx_abc123'
        })

        // Should not send response
        expect(mockContext.json).not.toHaveBeenCalled()

        // Verify handleFixedPrice was called with payment header
        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].paymentHeader).toBe('valid_signature')
      })

      it('should handle settlement failure', async () => {
        ;(mockContext.req.header as any).mockImplementation((name: string) => {
          if (name === 'payment-signature') return 'invalid_signature'
          return undefined
        })

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
        const result = await middleware(mockContext as any, mockNext)

        // Should not call next() - responds with error
        expect(mockNext).not.toHaveBeenCalled()

        // Should respond with error
        expect(mockContext.json).toHaveBeenCalledWith(
          {
            error: 'Payment failed',
            error_reason: 'INVALID_SIGNATURE'
          },
          402
        )
      })
    })

    describe('Bypass Payment Configuration', () => {
      it('should bypass payment when condition is met', async () => {
        mockContext.variables.userRole = 'admin'

        const bypassCondition = (c: any) => c.variables.userRole === 'admin'

        const middleware = fixedPrice(
          mockSangria,
          { price: 0.01 },
          { bypassPaymentIf: bypassCondition }
        )

        const result = await middleware(mockContext as any, mockNext)

        // Should call next() to continue
        expect(mockNext).toHaveBeenCalledOnce()

        // Should set default payment data
        expect(mockContext.set).toHaveBeenCalledWith('sangria', {
          paid: false,
          amount: 0
        })

        // Should not call Sangria
        expect(mockSangria.handleFixedPrice).not.toHaveBeenCalled()
      })

      it('should not bypass payment when condition is not met', async () => {
        mockContext.variables.userRole = 'user'

        const bypassCondition = (c: any) => c.variables.userRole === 'admin'

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

        const result = await middleware(mockContext as any, mockNext)

        // Should require payment (not bypass)
        expect(mockNext).not.toHaveBeenCalled()
        expect(mockSangria.handleFixedPrice).toHaveBeenCalled()
        expect(mockContext.json).toHaveBeenCalledWith({ payment_id: 'test' }, 402)
      })

      it('should handle bypass condition throwing error', async () => {
        const bypassCondition = (c: any) => {
          throw new Error('Bypass condition error')
        }

        const middleware = fixedPrice(
          mockSangria,
          { price: 0.01 },
          { bypassPaymentIf: bypassCondition }
        )

        // Should propagate the error
        await expect(
          middleware(mockContext as any, mockNext)
        ).rejects.toThrow('Bypass condition error')
      })
    })

    describe('Header Handling', () => {
      it('should handle missing payment-signature header', async () => {
        ;(mockContext.req.header as any).mockReturnValue(undefined)

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const middleware = fixedPrice(mockSangria, { price: 0.01 })
        await middleware(mockContext as any, mockNext)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].paymentHeader).toBeUndefined()
      })

      it('should handle empty string payment header', async () => {
        ;(mockContext.req.header as any).mockImplementation((name: string) => {
          if (name === 'payment-signature') return ''
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
        await middleware(mockContext as any, mockNext)

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
        await middleware(mockContext as any, mockNext)

        expect(mockContext.header).toHaveBeenCalledWith('PAYMENT-REQUIRED', 'encoded_payload')
        expect(mockContext.header).toHaveBeenCalledWith('X-Custom-Header', 'custom_value')
        expect(mockContext.header).toHaveBeenCalledWith('Cache-Control', 'no-cache')
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
        await middleware(mockContext as any, mockNext)

        // Should not call header when no headers provided
        expect(mockContext.header).not.toHaveBeenCalled()
        expect(mockContext.json).toHaveBeenCalledWith({ payment_id: 'test' }, 402)
      })
    })

    describe('Price and Options Validation', () => {
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
          await middleware(mockContext as any, mockNext)

          const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
          expect(callArgs[1].price).toBe(price)

          // Reset mocks for next iteration
          vi.clearAllMocks()
          ;(mockSangria.handleFixedPrice as any).mockClear()
        }
      })

      it('should pass description when provided', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const middleware = fixedPrice(mockSangria, {
          price: 0.01,
          description: 'Premium Hono service access'
        })

        await middleware(mockContext as any, mockNext)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[1].description).toBe('Premium Hono service access')
      })

      it('should handle missing description', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const middleware = fixedPrice(mockSangria, { price: 0.01 })
        await middleware(mockContext as any, mockNext)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[1].description).toBeUndefined()
      })
    })

    describe('Error Handling', () => {
      it('should handle Sangria errors gracefully', async () => {
        ;(mockSangria.handleFixedPrice as any).mockRejectedValue(
          new Error('Service unavailable')
        )

        const middleware = fixedPrice(mockSangria, { price: 0.01 })

        // Should propagate the error (middleware doesn't catch Sangria errors)
        await expect(
          middleware(mockContext as any, mockNext)
        ).rejects.toThrow('Service unavailable')
      })

      it('should handle invalid response action', async () => {
        const invalidResponse = {
          action: 'invalid_action' as any,
          status: 200,
          body: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(invalidResponse)

        const middleware = fixedPrice(mockSangria, { price: 0.01 })
        await middleware(mockContext as any, mockNext)

        // Should proceed since action is not 'respond'
        expect(mockNext).toHaveBeenCalledOnce()
      })

      it('should handle context method errors', async () => {
        // Mock context.set to throw an error
        mockContext.set = vi.fn().mockImplementation(() => {
          throw new Error('Context set error')
        })

        const mockSettlementResponse = {
          action: 'proceed' as const,
          data: { paid: true, amount: 0.01 }
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockSettlementResponse)

        const middleware = fixedPrice(mockSangria, { price: 0.01 })

        // Should propagate the context error
        await expect(
          middleware(mockContext as any, mockNext)
        ).rejects.toThrow('Context set error')
      })
    })

    describe('Concurrent Middleware Executions', () => {
      it('should handle concurrent middleware executions', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: { payment_id: 'concurrent_test' },
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const middleware = fixedPrice(mockSangria, { price: 0.01 })

        // Create multiple contexts
        const contexts = Array.from({ length: 5 }, (_, i) => ({
          ...mockContext,
          req: {
            ...mockContext.req,
            url: `https://api.example.com/api/premium/${i}`
          }
        }))

        const nextFunctions = Array.from({ length: 5 }, () => vi.fn())

        // Execute concurrent middleware calls
        const promises = contexts.map((context, i) =>
          middleware(context as any, nextFunctions[i])
        )

        await Promise.all(promises)

        // All should have been processed
        expect(mockSangria.handleFixedPrice).toHaveBeenCalledTimes(5)

        // All should have responded with JSON
        contexts.forEach(context => {
          expect(context.json).toHaveBeenCalledWith(
            { payment_id: 'concurrent_test' },
            402
          )
        })
      })
    })
  })

  describe('getSangria Utility', () => {
    it('should retrieve sangria data from context', () => {
      const mockPaymentData = {
        paid: true,
        amount: 1.50,
        transaction: 'tx_test123'
      }

      ;(mockContext.get as any).mockImplementation((key: string) => {
        if (key === 'sangria') return mockPaymentData
        return undefined
      })

      const result = getSangria(mockContext as any)

      expect(mockContext.get).toHaveBeenCalledWith('sangria')
      expect(result).toEqual(mockPaymentData)
    })

    it('should return undefined when no sangria data exists', () => {
      ;(mockContext.get as any).mockReturnValue(undefined)

      const result = getSangria(mockContext as any)

      expect(mockContext.get).toHaveBeenCalledWith('sangria')
      expect(result).toBeUndefined()
    })

    it('should handle context get method throwing error', () => {
      ;(mockContext.get as any).mockImplementation(() => {
        throw new Error('Context get error')
      })

      expect(() => {
        getSangria(mockContext as any)
      }).toThrow('Context get error')
    })
  })

  describe('Integration Scenarios', () => {
    it('should work with complete payment flow', async () => {
      // Step 1: Initial request without payment header
      const middleware = fixedPrice(mockSangria, { price: 0.01 })

      const mockPaymentResponse = {
        action: 'respond' as const,
        status: 402,
        body: { payment_id: 'test_payment' },
        headers: { 'PAYMENT-REQUIRED': 'encoded_payload' }
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

      await middleware(mockContext as any, mockNext)

      expect(mockContext.json).toHaveBeenCalledWith(
        { payment_id: 'test_payment' },
        402
      )
      expect(mockContext.header).toHaveBeenCalledWith('PAYMENT-REQUIRED', 'encoded_payload')

      // Reset mocks
      vi.clearAllMocks()
      ;(mockSangria.handleFixedPrice as any).mockClear()

      // Step 2: Second request with payment header
      ;(mockContext.req.header as any).mockImplementation((name: string) => {
        if (name === 'payment-signature') return 'valid_payment_signature'
        return undefined
      })

      const mockSettlementResponse = {
        action: 'proceed' as const,
        data: { paid: true, amount: 0.01, transaction: 'tx_success' }
      }

      ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockSettlementResponse)

      await middleware(mockContext as any, mockNext)

      expect(mockNext).toHaveBeenCalledOnce()
      expect(mockContext.set).toHaveBeenCalledWith('sangria', {
        paid: true,
        amount: 0.01,
        transaction: 'tx_success'
      })

      // Step 3: Retrieve payment data using getSangria
      ;(mockContext.get as any).mockImplementation((key: string) => {
        if (key === 'sangria') return { paid: true, amount: 0.01, transaction: 'tx_success' }
        return undefined
      })

      const paymentData = getSangria(mockContext as any)
      expect(paymentData).toEqual({
        paid: true,
        amount: 0.01,
        transaction: 'tx_success'
      })
    })
  })
})