/**
 * TypeScript Fastify Adapter Tests
 * Tests fixedPrice preHandler and sangriaPlugin with comprehensive framework integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fixedPrice, sangriaPlugin } from '../../../sdk/sdk-typescript/src/adapters/fastify.js'
import { Sangria } from '../../../sdk/sdk-typescript/src/core.js'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { SangriaConfig, FixedPriceOptions } from '../../../sdk/sdk-typescript/src/types.js'

describe('Fastify Adapter', () => {
  let mockSangria: Sangria
  let mockRequest: Partial<FastifyRequest>
  let mockReply: Partial<FastifyReply>

  beforeEach(() => {
    // Create mock Sangria instance
    const config: SangriaConfig = { apiKey: 'test-key' }
    mockSangria = new Sangria(config)

    // Mock the handleFixedPrice method
    vi.spyOn(mockSangria, 'handleFixedPrice')

    // Create mock Fastify objects
    mockRequest = {
      headers: {},
      protocol: 'https',
      hostname: 'api.example.com',
      url: '/api/premium'
    }

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      headers: vi.fn().mockReturnThis()
    }
  })

  describe('sangriaPlugin', () => {
    it('should register sangria property on request', async () => {
      const mockFastify = {
        decorateRequest: vi.fn()
      } as Partial<FastifyInstance>

      await sangriaPlugin(mockFastify as FastifyInstance)

      expect(mockFastify.decorateRequest).toHaveBeenCalledWith('sangria', undefined)
    })

    it('should have correct plugin metadata', () => {
      // Plugin should have a name for proper registration
      expect(sangriaPlugin).toBeDefined()
      // The fp() wrapper should preserve plugin metadata
    })
  })

  describe('fixedPrice PreHandler', () => {
    describe('Payment Generation Flow', () => {
      it('should generate payment when no payment header provided', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: { payment_id: 'test_payment', challenge: 'test_challenge' },
          headers: { 'PAYMENT-REQUIRED': 'encoded_payload' }
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, {
          price: 0.01,
          description: 'Test payment'
        })

        const result = await preHandler(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply
        )

        // PreHandler should return the reply (Fastify pattern)
        expect(result).toBe(mockReply)

        // Should set headers and respond with 402
        expect(mockReply.headers).toHaveBeenCalledWith({
          'PAYMENT-REQUIRED': 'encoded_payload'
        })
        expect(mockReply.status).toHaveBeenCalledWith(402)
        expect(mockReply.send).toHaveBeenCalledWith({
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

      it('should handle headers host fallback', async () => {
        mockRequest.hostname = undefined
        mockRequest.headers = { host: 'fallback.example.com' }

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].resourceUrl).toBe('https://fallback.example.com/api/premium')
      })

      it('should construct resource URL with query parameters', async () => {
        mockRequest.url = '/api/premium?param=value&other=test'

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].resourceUrl).toBe('https://api.example.com/api/premium?param=value&other=test')
      })
    })

    describe('Payment Settlement Flow', () => {
      it('should settle payment when payment header provided', async () => {
        mockRequest.headers = {
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

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        const result = await preHandler(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply
        )

        // Should not return a response (proceeds to route handler)
        expect(result).toBeUndefined()

        // Should attach payment data to request
        expect(mockRequest.sangria).toEqual({
          paid: true,
          amount: 0.01,
          transaction: 'tx_abc123'
        })

        // Should not send response
        expect(mockReply.status).not.toHaveBeenCalled()
        expect(mockReply.send).not.toHaveBeenCalled()

        // Verify handleFixedPrice was called with payment header
        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].paymentHeader).toBe('valid_signature')
      })

      it('should handle settlement failure', async () => {
        mockRequest.headers = {
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

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        const result = await preHandler(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply
        )

        // Should return the reply (stops processing)
        expect(result).toBe(mockReply)

        // Should respond with error
        expect(mockReply.status).toHaveBeenCalledWith(402)
        expect(mockReply.send).toHaveBeenCalledWith({
          error: 'Payment failed',
          error_reason: 'INVALID_SIGNATURE'
        })
      })
    })

    describe('Bypass Payment Configuration', () => {
      it('should bypass payment when condition is met', async () => {
        mockRequest.headers = {
          'x-admin': 'true'
        }

        const bypassCondition = (request: FastifyRequest) =>
          request.headers['x-admin'] === 'true'

        const preHandler = fixedPrice(
          mockSangria,
          { price: 0.01 },
          { bypassPaymentIf: bypassCondition }
        )

        const result = await preHandler(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply
        )

        // Should proceed without payment (no return value)
        expect(result).toBeUndefined()

        // Should set default payment data
        expect(mockRequest.sangria).toEqual({
          paid: false,
          amount: 0
        })

        // Should not call Sangria
        expect(mockSangria.handleFixedPrice).not.toHaveBeenCalled()
      })

      it('should not bypass payment when condition is not met', async () => {
        mockRequest.headers = {
          'x-admin': 'false'
        }

        const bypassCondition = (request: FastifyRequest) =>
          request.headers['x-admin'] === 'true'

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: { payment_id: 'test' },
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(
          mockSangria,
          { price: 0.01 },
          { bypassPaymentIf: bypassCondition }
        )

        const result = await preHandler(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply
        )

        // Should require payment (return reply)
        expect(result).toBe(mockReply)
        expect(mockSangria.handleFixedPrice).toHaveBeenCalled()
        expect(mockReply.status).toHaveBeenCalledWith(402)
      })

      it('should handle bypass condition throwing error', async () => {
        const bypassCondition = (request: FastifyRequest) => {
          throw new Error('Bypass condition error')
        }

        const preHandler = fixedPrice(
          mockSangria,
          { price: 0.01 },
          { bypassPaymentIf: bypassCondition }
        )

        // Should propagate the error
        await expect(
          preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)
        ).rejects.toThrow('Bypass condition error')
      })
    })

    describe('Header Handling', () => {
      it('should handle multiple payment signature headers', async () => {
        mockRequest.headers = {
          'payment-signature': ['signature1', 'signature2'] // Array format
        }

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        // Should use first header when multiple are provided
        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].paymentHeader).toBe('signature1')
      })

      it('should handle missing payment-signature header', async () => {
        mockRequest.headers = {}

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].paymentHeader).toBeUndefined()
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

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        expect(mockReply.headers).toHaveBeenCalledWith({
          'PAYMENT-REQUIRED': 'encoded_payload',
          'X-Custom-Header': 'custom_value',
          'Cache-Control': 'no-cache'
        })
      })

      it('should handle response without headers', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: { payment_id: 'test' }
          // No headers property
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        // Should not call headers when no headers provided
        expect(mockReply.headers).not.toHaveBeenCalled()
        expect(mockReply.status).toHaveBeenCalledWith(402)
        expect(mockReply.send).toHaveBeenCalledWith({ payment_id: 'test' })
      })
    })

    describe('Price and Options Validation', () => {
      it('should handle various valid price formats', async () => {
        const validPrices = [0.01, 1, 0.000001, 999.99]

        for (const price of validPrices) {
          const mockPaymentResponse = {
            action: 'respond' as const,
            status: 402,
            body: {},
            headers: {}
          }

          ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

          const preHandler = fixedPrice(mockSangria, { price })
          await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

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

        const preHandler = fixedPrice(mockSangria, {
          price: 0.01,
          description: 'Premium content access'
        })

        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[1].description).toBe('Premium content access')
      })

      it('should handle missing description', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[1].description).toBeUndefined()
      })
    })

    describe('Protocol and URL Handling', () => {
      it('should handle different protocols', async () => {
        const protocols = ['http', 'https']

        for (const protocol of protocols) {
          mockRequest.protocol = protocol

          const mockPaymentResponse = {
            action: 'respond' as const,
            status: 402,
            body: {},
            headers: {}
          }

          ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

          const preHandler = fixedPrice(mockSangria, { price: 0.01 })
          await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

          const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
          expect(callArgs[0].resourceUrl).toMatch(new RegExp(`^${protocol}://`))

          // Reset for next iteration
          ;(mockSangria.handleFixedPrice as any).mockClear()
        }
      })

      it('should handle missing hostname gracefully', async () => {
        mockRequest.hostname = undefined
        mockRequest.headers = {} // No host header either

        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: {},
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
        expect(callArgs[0].resourceUrl).toBe('https://undefined/api/premium')
      })

      it('should handle complex URLs', async () => {
        const complexUrls = [
          '/api/premium',
          '/api/premium?param=value',
          '/api/premium?param=value&other=test',
          '/api/premium/sub/path?query=test#fragment',
          '/api/café/unicode'
        ]

        for (const url of complexUrls) {
          mockRequest.url = url

          const mockPaymentResponse = {
            action: 'respond' as const,
            status: 402,
            body: {},
            headers: {}
          }

          ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

          const preHandler = fixedPrice(mockSangria, { price: 0.01 })
          await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

          const callArgs = (mockSangria.handleFixedPrice as any).mock.calls[0]
          expect(callArgs[0].resourceUrl).toContain(url)

          // Reset for next iteration
          ;(mockSangria.handleFixedPrice as any).mockClear()
        }
      })
    })

    describe('Error Handling', () => {
      it('should handle Sangria errors gracefully', async () => {
        ;(mockSangria.handleFixedPrice as any).mockRejectedValue(
          new Error('Service unavailable')
        )

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })

        // Should propagate the error (preHandler doesn't catch Sangria errors)
        await expect(
          preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)
        ).rejects.toThrow('Service unavailable')
      })

      it('should handle invalid response action', async () => {
        const invalidResponse = {
          action: 'invalid_action' as any,
          status: 200,
          body: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(invalidResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })

        // Should handle gracefully (TypeScript would catch this, but testing runtime)
        const result = await preHandler(
          mockRequest as FastifyRequest,
          mockReply as FastifyReply
        )

        // Should proceed since action is not 'respond'
        expect(result).toBeUndefined()
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

        const preHandler = fixedPrice(mockSangria, { price: 1.50 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        expect(mockRequest.sangria).toEqual(mockPaymentData)
      })

      it('should handle payment data with missing fields', async () => {
        const mockPaymentData = {
          paid: true,
          amount: 0.50
          // Missing transaction
        }

        const mockSettlementResponse = {
          action: 'proceed' as const,
          data: mockPaymentData
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockSettlementResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.50 })
        await preHandler(mockRequest as FastifyRequest, mockReply as FastifyReply)

        expect(mockRequest.sangria).toEqual({
          paid: true,
          amount: 0.50
        })
      })
    })

    describe('Concurrent PreHandler Executions', () => {
      it('should handle concurrent preHandler executions', async () => {
        const mockPaymentResponse = {
          action: 'respond' as const,
          status: 402,
          body: { payment_id: 'concurrent_test' },
          headers: {}
        }

        ;(mockSangria.handleFixedPrice as any).mockResolvedValue(mockPaymentResponse)

        const preHandler = fixedPrice(mockSangria, { price: 0.01 })

        // Create multiple requests
        const requests = Array.from({ length: 5 }, (_, i) => ({
          ...mockRequest,
          url: `/api/premium/${i}`
        }))

        const replies = Array.from({ length: 5 }, () => ({ ...mockReply }))

        // Execute concurrent preHandler calls
        const promises = requests.map((req, i) =>
          preHandler(req as FastifyRequest, replies[i] as FastifyReply)
        )

        await Promise.all(promises)

        // All should have been processed
        expect(mockSangria.handleFixedPrice).toHaveBeenCalledTimes(5)

        // All should have responded with 402
        replies.forEach(reply => {
          expect(reply.status).toHaveBeenCalledWith(402)
        })
      })
    })
  })
})