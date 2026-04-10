/**
 * TypeScript SDK Core Unit Tests
 * Comprehensive tests for the Sangria TypeScript SDK core functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Sangria } from '../../../sdk/sdk-typescript/src/core.js'
import type { SangriaConfig, FixedPriceOptions, PaymentContext, PaymentResult } from '../../../sdk/sdk-typescript/src/types.js'

describe('Sangria SDK Core', () => {
  let mockFetch: any
  let consoleErrorSpy: any

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn()
    global.fetch = mockFetch

    // Spy on console.error to suppress error output in tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.resetAllMocks()
    consoleErrorSpy.mockRestore()
  })

  describe('Constructor', () => {
    it('should create instance with valid config', () => {
      const config: SangriaConfig = {
        apiKey: 'test-api-key'
      }

      const sangria = new Sangria(config)
      expect(sangria).toBeInstanceOf(Sangria)
    })

    it('should use custom baseUrl when provided', () => {
      const config: SangriaConfig = {
        apiKey: 'test-api-key',
        baseUrl: 'https://custom.api.com'
      }

      const sangria = new Sangria(config)
      expect(sangria).toBeInstanceOf(Sangria)
    })

    it('should remove trailing slashes from baseUrl', async () => {
      const config: SangriaConfig = {
        apiKey: 'test-api-key',
        baseUrl: 'https://api.example.com///'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ test: 'data' })
      })

      const sangria = new Sangria(config)

      // Trigger a request to see the actual URL used
      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      await sangria.handleFixedPrice(ctx, options)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v1/generate-payment',
        expect.any(Object)
      )
    })

    it('should throw error when apiKey is missing', () => {
      expect(() => {
        new Sangria({ apiKey: '' })
      }).toThrow('Sangria: apiKey is required')
    })

    it('should throw error when apiKey is undefined', () => {
      expect(() => {
        new Sangria({} as SangriaConfig)
      }).toThrow('Sangria: apiKey is required')
    })
  })

  describe('Price Validation', () => {
    let sangria: Sangria

    beforeEach(() => {
      sangria = new Sangria({ apiKey: 'test-key' })
    })

    it('should reject zero price', async () => {
      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const options: FixedPriceOptions = {
        price: 0
      }

      await expect(sangria.handleFixedPrice(ctx, options)).rejects.toThrow(
        'Sangria: price must be a finite number greater than 0'
      )
    })

    it('should reject negative price', async () => {
      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const options: FixedPriceOptions = {
        price: -0.01
      }

      await expect(sangria.handleFixedPrice(ctx, options)).rejects.toThrow(
        'Sangria: price must be a finite number greater than 0'
      )
    })

    it('should reject NaN price', async () => {
      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const options: FixedPriceOptions = {
        price: NaN
      }

      await expect(sangria.handleFixedPrice(ctx, options)).rejects.toThrow(
        'Sangria: price must be a finite number greater than 0'
      )
    })

    it('should reject Infinity price', async () => {
      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const options: FixedPriceOptions = {
        price: Infinity
      }

      await expect(sangria.handleFixedPrice(ctx, options)).rejects.toThrow(
        'Sangria: price must be a finite number greater than 0'
      )
    })

    it('should accept valid positive price', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payment_id: 'test-payment',
          challenge: 'test-challenge'
        })
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)
      expect(result.action).toBe('respond')
    })
  })

  describe('Payment Generation', () => {
    let sangria: Sangria

    beforeEach(() => {
      sangria = new Sangria({ apiKey: 'test-key', baseUrl: 'https://api.test.com' })
    })

    it('should generate payment when no payment header provided', async () => {
      const mockPayload = {
        payment_id: 'payment_123',
        challenge: 'challenge_456',
        amount: 0.01,
        resource: '/api/premium'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPayload)
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01,
        description: 'Test payment'
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('respond')
      expect(result.status).toBe(402)
      expect(result.body).toEqual(mockPayload)
      expect(result.headers?.['PAYMENT-REQUIRED']).toBeDefined()

      // Verify the encoded header can be decoded
      const encodedHeader = result.headers!['PAYMENT-REQUIRED']
      const decoded = JSON.parse(atob(encodedHeader))
      expect(decoded).toEqual(mockPayload)

      // Verify API call
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/generate-payment',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key'
          },
          body: JSON.stringify({
            amount: 0.01,
            resource: '/api/premium',
            description: 'Test payment'
          }),
          signal: expect.any(AbortSignal)
        }
      )
    })

    it('should handle API errors during payment generation gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('respond')
      expect(result.status).toBe(500)
      expect(result.body).toEqual({ error: 'Payment service unavailable' })
    })

    it('should handle network errors during payment generation', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('respond')
      expect(result.status).toBe(500)
      expect(result.body).toEqual({ error: 'Payment service unavailable' })
    })

    it('should include description when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ payment_id: 'test' })
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01,
        description: 'Premium content access'
      }

      await sangria.handleFixedPrice(ctx, options)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            amount: 0.01,
            resource: '/api/premium',
            description: 'Premium content access'
          })
        })
      )
    })
  })

  describe('Payment Settlement', () => {
    let sangria: Sangria

    beforeEach(() => {
      sangria = new Sangria({ apiKey: 'test-key', baseUrl: 'https://api.test.com' })
    })

    it('should settle payment when payment header is provided', async () => {
      const mockSettlementResponse = {
        success: true,
        transaction: 'tx_abc123'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSettlementResponse)
      })

      const ctx: PaymentContext = {
        paymentHeader: 'payment-header-123',
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('proceed')
      expect(result.data).toEqual({
        paid: true,
        amount: 0.01,
        transaction: 'tx_abc123'
      })

      // Verify API call
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/settle-payment',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key'
          },
          body: JSON.stringify({
            payment_payload: 'payment-header-123'
          }),
          signal: expect.any(AbortSignal)
        }
      )
    })

    it('should handle settlement failures with specific error reasons', async () => {
      const mockErrorResponse = {
        success: false,
        error_reason: 'INSUFFICIENT_FUNDS',
        error_message: 'Insufficient balance for payment'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockErrorResponse)
      })

      const ctx: PaymentContext = {
        paymentHeader: 'payment-header-123',
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('respond')
      expect(result.status).toBe(402)
      expect(result.body).toEqual({
        error: 'Insufficient balance for payment',
        error_reason: 'INSUFFICIENT_FUNDS'
      })
    })

    it('should handle settlement failures without specific error message', async () => {
      const mockErrorResponse = {
        success: false,
        error_reason: 'INVALID_SIGNATURE'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockErrorResponse)
      })

      const ctx: PaymentContext = {
        paymentHeader: 'payment-header-123',
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('respond')
      expect(result.status).toBe(402)
      expect(result.body).toEqual({
        error: 'Payment failed',
        error_reason: 'INVALID_SIGNATURE'
      })
    })

    it('should handle API errors during settlement', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const ctx: PaymentContext = {
        paymentHeader: 'payment-header-123',
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('respond')
      expect(result.status).toBe(500)
      expect(result.body).toEqual({ error: 'Payment settlement failed' })
    })

    it('should handle network errors during settlement', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'))

      const ctx: PaymentContext = {
        paymentHeader: 'payment-header-123',
        resourceUrl: '/api/premium'
      }

      const options: FixedPriceOptions = {
        price: 0.01
      }

      const result = await sangria.handleFixedPrice(ctx, options)

      expect(result.action).toBe('respond')
      expect(result.status).toBe(500)
      expect(result.body).toEqual({ error: 'Payment settlement failed' })
    })
  })

  describe('Request Configuration', () => {
    let sangria: Sangria

    beforeEach(() => {
      sangria = new Sangria({ apiKey: 'secret-key', baseUrl: 'https://api.example.com' })
    })

    it('should set correct headers for API requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ test: 'data' })
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      await sangria.handleFixedPrice(ctx, { price: 0.01 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer secret-key'
          }
        })
      )
    })

    it('should set timeout for API requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ test: 'data' })
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      await sangria.handleFixedPrice(ctx, { price: 0.01 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      )
    })
  })

  describe('Edge Cases and Error Handling', () => {
    let sangria: Sangria

    beforeEach(() => {
      sangria = new Sangria({ apiKey: 'test-key' })
    })

    it('should handle malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const result = await sangria.handleFixedPrice(ctx, { price: 0.01 })

      expect(result.action).toBe('respond')
      expect(result.status).toBe(500)
    })

    it('should handle timeout errors', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.reject(new DOMException('Request timed out', 'AbortError'))
      )

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const result = await sangria.handleFixedPrice(ctx, { price: 0.01 })

      expect(result.action).toBe('respond')
      expect(result.status).toBe(500)
    }, 15000)

    it('should handle large price values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ payment_id: 'test' })
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      // Test with maximum safe JavaScript number
      const largePrice = Number.MAX_SAFE_INTEGER / 1000000 // Still finite

      const result = await sangria.handleFixedPrice(ctx, { price: largePrice })

      expect(result.action).toBe('respond')
      expect(result.status).toBe(402)
    })

    it('should handle very small price values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ payment_id: 'test' })
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      // Test with very small but valid price
      const smallPrice = 0.000001

      const result = await sangria.handleFixedPrice(ctx, { price: smallPrice })

      expect(result.action).toBe('respond')
      expect(result.status).toBe(402)
    })

    it('should handle empty payment header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ test: 'data' })
      })

      const ctx: PaymentContext = {
        paymentHeader: '', // Empty string should be treated as no header
        resourceUrl: '/api/test'
      }

      const result = await sangria.handleFixedPrice(ctx, { price: 0.01 })

      // Should generate new payment instead of settling
      expect(result.action).toBe('respond')
      expect(result.status).toBe(402)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/generate-payment'),
        expect.any(Object)
      )
    })

    it('should handle missing transaction in settlement response', async () => {
      const mockResponse = {
        success: true
        // Missing transaction field
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })

      const ctx: PaymentContext = {
        paymentHeader: 'payment-header-123',
        resourceUrl: '/api/test'
      }

      const result = await sangria.handleFixedPrice(ctx, { price: 0.01 })

      expect(result.action).toBe('proceed')
      expect(result.data).toEqual({
        paid: true,
        amount: 0.01,
        transaction: undefined
      })
    })
  })

  describe('Type Safety', () => {
    it('should ensure PaymentResult discriminated union works correctly', async () => {
      const sangria = new Sangria({ apiKey: 'test-key' })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ payment_id: 'test' })
      })

      const ctx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/api/test'
      }

      const result = await sangria.handleFixedPrice(ctx, { price: 0.01 })

      // TypeScript should ensure proper discrimination
      if (result.action === 'respond') {
        expect(result.status).toBeDefined()
        expect(result.body).toBeDefined()
      } else {
        expect(result.data).toBeDefined()
      }
    })
  })
})