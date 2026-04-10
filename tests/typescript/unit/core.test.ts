/**
 * Unit tests for Sangria TypeScript SDK core functionality.
 */

import { beforeEach, describe, expect, it, vi, Mock, beforeAll } from 'vitest'
import { Sangria } from '../../../sdk/sdk-typescript/src/core.js'
import type {
  SangriaConfig,
  FixedPriceOptions,
  PaymentContext,
  PaymentResult
} from '../../../sdk/sdk-typescript/src/types.js'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch as any

// Disable MSW for this unit test file
beforeAll(() => {
  // Reset any MSW handlers that might interfere
  process.env.NODE_ENV = 'unit-test'
})

describe('Sangria Core', () => {
  const mockConfig: SangriaConfig = {
    apiKey: 'test_api_key_123',
    baseUrl: 'https://api.test-sangria.net'
  }

  let sangria: Sangria

  beforeEach(() => {
    mockFetch.mockClear()
    sangria = new Sangria(mockConfig)
  })

  describe('constructor', () => {
    it('should initialize with required config', () => {
      const config: SangriaConfig = { apiKey: 'test_key' }
      const instance = new Sangria(config)
      expect(instance).toBeInstanceOf(Sangria)
    })

    it('should use default base URL when not provided', () => {
      const config: SangriaConfig = { apiKey: 'test_key' }
      const instance = new Sangria(config)

      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }
      const options: FixedPriceOptions = { price: 10 }

      // Trigger a call that uses baseUrl to verify it's set to default
      const mockResponse = { payment_id: 'test' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      instance.handleFixedPrice(mockPaymentCtx, options)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/generate-payment',
        expect.any(Object)
      )
    })

    it('should strip trailing slash from base URL', () => {
      const config: SangriaConfig = {
        apiKey: 'test_key',
        baseUrl: 'https://api.test.com/'
      }
      const instance = new Sangria(config)

      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }
      const options: FixedPriceOptions = { price: 10 }

      const mockResponse = { payment_id: 'test' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      instance.handleFixedPrice(mockPaymentCtx, options)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/generate-payment',
        expect.any(Object)
      )
    })

    it('should throw error when apiKey is missing', () => {
      expect(() => new Sangria({} as SangriaConfig)).toThrow('Sangria: apiKey is required')
    })

    it('should throw error when apiKey is empty string', () => {
      expect(() => new Sangria({ apiKey: '' })).toThrow('Sangria: apiKey is required')
    })
  })

  describe('validateFixedPriceOptions', () => {
    it('should accept valid price', async () => {
      const options: FixedPriceOptions = { price: 10.50 }
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }

      const mockResponse = { payment_id: 'test' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      await expect(
        sangria.handleFixedPrice(mockPaymentCtx, options)
      ).resolves.toBeDefined()
    })

    it('should reject zero price', async () => {
      const options: FixedPriceOptions = { price: 0 }
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }

      await expect(
        sangria.handleFixedPrice(mockPaymentCtx, options)
      ).rejects.toThrow('Sangria: price must be a finite number greater than 0')
    })

    it('should reject negative price', async () => {
      const options: FixedPriceOptions = { price: -5.99 }
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }

      await expect(
        sangria.handleFixedPrice(mockPaymentCtx, options)
      ).rejects.toThrow('Sangria: price must be a finite number greater than 0')
    })

    it('should reject infinite price', async () => {
      const options: FixedPriceOptions = { price: Number.POSITIVE_INFINITY }
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }

      await expect(
        sangria.handleFixedPrice(mockPaymentCtx, options)
      ).rejects.toThrow('Sangria: price must be a finite number greater than 0')
    })

    it('should reject NaN price', async () => {
      const options: FixedPriceOptions = { price: Number.NaN }
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }

      await expect(
        sangria.handleFixedPrice(mockPaymentCtx, options)
      ).rejects.toThrow('Sangria: price must be a finite number greater than 0')
    })
  })

  describe('handleFixedPrice', () => {
    it('should call generatePayment when no payment header', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/premium/article'
      }
      const options: FixedPriceOptions = {
        price: 15.99,
        description: 'Premium content'
      }

      const mockX402Response = {
        payment_id: 'pay_test_123',
        amount: 15.99,
        payment_url: 'https://pay.sangria.net/pay_test_123'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockX402Response)
      } as Response)

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('respond')
      if (result.action === 'respond') {
        expect(result.status).toBe(402)
        expect(result.body).toEqual(mockX402Response)
        expect(result.headers?.['PAYMENT-REQUIRED']).toBeDefined()
        expect(typeof result.headers?.['PAYMENT-REQUIRED']).toBe('string')
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test-sangria.net/v1/generate-payment',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test_api_key_123'
          },
          body: JSON.stringify({
            amount: 15.99,
            resource: '/premium/article',
            description: 'Premium content'
          } as Response),
          signal: expect.any(AbortSignal)
        }
      )
    })

    it('should call settlePayment when payment header provided', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: 'payment_signature_xyz789',
        resourceUrl: '/api/data'
      }
      const options: FixedPriceOptions = { price: 8.50 }

      const mockSettleResponse = {
        success: true,
        transaction: 'tx_settlement_abc',
        amount: 8.50
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSettleResponse)
      } as Response)

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('proceed')
      if (result.action === 'proceed') {
        expect(result.data.paid).toBe(true)
        expect(result.data.amount).toBe(8.50)
        expect(result.data.transaction).toBe('tx_settlement_abc')
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test-sangria.net/v1/settle-payment',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test_api_key_123'
          },
          body: JSON.stringify({
            payment_payload: 'payment_signature_xyz789'
          } as Response),
          signal: expect.any(AbortSignal)
        }
      )
    })
  })

  describe('generatePayment', () => {
    it('should create proper X402 response with encoded header', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test/resource'
      }
      const options: FixedPriceOptions = {
        price: 25.00,
        description: 'Test resource'
      }

      const mockApiResponse = {
        payment_id: 'pay_test_456',
        amount: 25.00,
        currency: 'USD'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse)
      } as Response)

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('respond')
      if (result.action === 'respond') {
        expect(result.status).toBe(402)
        expect(result.body).toEqual(mockApiResponse)

        // Verify base64 encoding
        const encodedHeader = result.headers?.['PAYMENT-REQUIRED']
        expect(encodedHeader).toBeDefined()

        const decodedPayload = JSON.parse(atob(encodedHeader!))
        expect(decodedPayload).toEqual(mockApiResponse)
      }
    })

    it('should handle API errors gracefully', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/test'
      }
      const options: FixedPriceOptions = { price: 10.00 }

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('respond')
      if (result.action === 'respond') {
        expect(result.status).toBe(500)
        expect(result.body).toEqual({ error: 'Payment service unavailable' })
      }
    })

    it('should send correct payload without description', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: undefined,
        resourceUrl: '/no-desc-resource'
      }
      const options: FixedPriceOptions = { price: 12.75 }

      const mockResponse = { payment_id: 'pay_123' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            amount: 12.75,
            resource: '/no-desc-resource'
          } as Response)
        } as Response)
      )
    })
  })

  describe('settlePayment', () => {
    it('should handle successful settlement', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: 'valid_signature',
        resourceUrl: '/settled/resource'
      }
      const options: FixedPriceOptions = { price: 30.00 }

      const mockResponse = {
        success: true,
        transaction: 'tx_final_789',
        amount: 30.00,
        timestamp: '2024-01-01T15:00:00Z'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('proceed')
      if (result.action === 'proceed') {
        expect(result.data.paid).toBe(true)
        expect(result.data.amount).toBe(30.00)
        expect(result.data.transaction).toBe('tx_final_789')
      }
    })

    it('should handle settlement failure', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: 'invalid_signature',
        resourceUrl: '/test'
      }
      const options: FixedPriceOptions = { price: 20.00 }

      const mockResponse = {
        success: false,
        error_message: 'Signature verification failed',
        error_reason: 'invalid_signature'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('respond')
      if (result.action === 'respond') {
        expect(result.status).toBe(402)
        expect(result.body).toEqual({
          error: 'Signature verification failed',
          error_reason: 'invalid_signature'
        } as Response)
      }
    })

    it('should use default error message when not provided', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: 'test_sig',
        resourceUrl: '/test'
      }
      const options: FixedPriceOptions = { price: 15.00 }

      const mockResponse = {
        success: false,
        error_reason: 'timeout'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('respond')
      if (result.action === 'respond') {
        expect(result.status).toBe(402)
        expect(result.body).toEqual({
          error: 'Payment failed',
          error_reason: 'timeout'
        } as Response)
      }
    })

    it('should handle missing transaction field', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: 'test_signature',
        resourceUrl: '/test'
      }
      const options: FixedPriceOptions = { price: 18.99 }

      const mockResponse = { success: true }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      } as Response)

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('proceed')
      if (result.action === 'proceed') {
        expect(result.data.paid).toBe(true)
        expect(result.data.amount).toBe(18.99)
        expect(result.data.transaction).toBeUndefined()
      }
    })

    it('should handle network errors', async () => {
      const mockPaymentCtx: PaymentContext = {
        paymentHeader: 'test_sig',
        resourceUrl: '/test'
      }
      const options: FixedPriceOptions = { price: 5.00 }

      mockFetch.mockRejectedValueOnce(new Error('Connection timeout'))

      const result = await sangria.handleFixedPrice(mockPaymentCtx, options)

      expect(result.action).toBe('respond')
      if (result.action === 'respond') {
        expect(result.status).toBe(500)
        expect(result.body).toEqual({ error: 'Payment settlement failed' })
      }
    })
  })
})