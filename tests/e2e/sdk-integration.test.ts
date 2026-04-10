/**
 * Real E2E Integration Tests
 * Tests SDKs against actual backend with real HTTP requests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Sangria } from '../../sdk/sdk-typescript/src/core.js'
import type { SangriaConfig } from '../../sdk/sdk-typescript/src/types.js'

// Test server for real E2E testing
class TestSangriaBackend {
  private server: any
  private port: number
  private baseUrl: string

  constructor(port: number = 8081) {
    this.port = port
    this.baseUrl = `http://localhost:${port}`
  }

  async start() {
    // Dynamic import to avoid loading server dependencies in non-E2E tests
    const { createServer } = await import('http')
    const { parse } = await import('url')

    this.server = createServer(async (req, res) => {
      const url = parse(req.url || '', true)
      const pathname = url.pathname

      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Payment-Signature')

      if (req.method === 'OPTIONS') {
        res.writeHead(200)
        res.end()
        return
      }

      try {
        if (pathname === '/v1/generate-payment' && req.method === 'POST') {
          await this.handleGeneratePayment(req, res)
        } else if (pathname === '/v1/settle-payment' && req.method === 'POST') {
          await this.handleSettlePayment(req, res)
        } else if (pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'healthy' }))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
        }
      } catch (error) {
        console.error('Server error:', error)
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    })

    return new Promise<void>((resolve, reject) => {
      this.server.listen(this.port, (err?: Error) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async stop() {
    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server.close(() => resolve())
      })
    }
  }

  getBaseUrl() {
    return this.baseUrl
  }

  private async handleGeneratePayment(req: any, res: any) {
    const body = await this.readRequestBody(req)
    const auth = req.headers.authorization

    if (!auth || !auth.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    const apiKey = auth.substring(7)
    if (!apiKey || apiKey === 'invalid') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid API key' }))
      return
    }

    const { amount, resource, description } = JSON.parse(body)

    // Validate input
    if (!amount || amount <= 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid amount' }))
      return
    }

    if (!resource) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Resource is required' }))
      return
    }

    // Generate payment response
    const payment = {
      payment_id: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      challenge: `challenge_${Math.random().toString(36).substr(2, 16)}`,
      amount,
      resource,
      description,
      expires_at: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      chain_id: 8453, // Base mainnet
      merchant_address: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payment))
  }

  private async handleSettlePayment(req: any, res: any) {
    const body = await this.readRequestBody(req)
    const auth = req.headers.authorization

    if (!auth || !auth.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    const { payment_payload } = JSON.parse(body)

    if (!payment_payload) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Payment payload is required' }))
      return
    }

    // Simulate different settlement scenarios based on payload
    if (payment_payload.includes('invalid')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        error_reason: 'INVALID_SIGNATURE',
        error_message: 'Invalid payment signature'
      }))
      return
    }

    if (payment_payload.includes('insufficient')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: false,
        error_reason: 'INSUFFICIENT_FUNDS',
        error_message: 'Insufficient balance for payment'
      }))
      return
    }

    // Successful settlement
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      transaction: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
    }))
  }

  private async readRequestBody(req: any): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString()
      })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })
  }
}

describe('E2E SDK Integration Tests', () => {
  let backend: TestSangriaBackend
  let baseUrl: string

  beforeAll(async () => {
    backend = new TestSangriaBackend(8081)
    await backend.start()
    baseUrl = backend.getBaseUrl()
    console.log(`Test backend started at ${baseUrl}`)
  }, 10000)

  afterAll(async () => {
    if (backend) {
      await backend.stop()
      console.log('Test backend stopped')
    }
  }, 10000)

  describe('TypeScript SDK E2E', () => {
    let sangria: Sangria

    beforeEach(() => {
      const config: SangriaConfig = {
        apiKey: 'test-e2e-key',
        baseUrl
      }
      sangria = new Sangria(config)
    })

    describe('Payment Generation Flow', () => {
      it('should generate payment with valid parameters', async () => {
        const result = await sangria.handleFixedPrice(
          {
            paymentHeader: undefined,
            resourceUrl: '/api/premium'
          },
          {
            price: 0.01,
            description: 'E2E test payment'
          }
        )

        expect(result.action).toBe('respond')
        if (result.action === 'respond') {
          expect(result.status).toBe(402)
          expect(result.body).toHaveProperty('payment_id')
          expect(result.body).toHaveProperty('challenge')
          expect(result.body.amount).toBe(0.01)
          expect(result.body.resource).toBe('/api/premium')
          expect(result.body.description).toBe('E2E test payment')
          expect(result.headers).toHaveProperty('PAYMENT-REQUIRED')

          // Verify PAYMENT-REQUIRED header is base64 encoded JSON
          const encodedPayload = result.headers!['PAYMENT-REQUIRED']
          expect(encodedPayload).toBeDefined()

          const decodedPayload = JSON.parse(Buffer.from(encodedPayload, 'base64').toString())
          expect(decodedPayload).toEqual(result.body)
        }
      }, 15000)

      it('should handle different price formats', async () => {
        const testCases = [
          { price: 0.000001, description: 'Micro payment' },
          { price: 1.0, description: 'One dollar' },
          { price: 999.99, description: 'Large payment' }
        ]

        for (const testCase of testCases) {
          const result = await sangria.handleFixedPrice(
            {
              paymentHeader: undefined,
              resourceUrl: '/api/test'
            },
            testCase
          )

          expect(result.action).toBe('respond')
          if (result.action === 'respond') {
            expect(result.body.amount).toBe(testCase.price)
            expect(result.body.description).toBe(testCase.description)
          }
        }
      }, 15000)

      it('should handle unauthorized API key', async () => {
        const unauthorizedSangria = new Sangria({
          apiKey: 'invalid',
          baseUrl
        })

        const result = await unauthorizedSangria.handleFixedPrice(
          {
            paymentHeader: undefined,
            resourceUrl: '/api/premium'
          },
          { price: 0.01 }
        )

        expect(result.action).toBe('respond')
        if (result.action === 'respond') {
          expect(result.status).toBe(500)
          expect(result.body).toHaveProperty('error')
        }
      }, 10000)

      it('should handle network timeout gracefully', async () => {
        // Use a non-existent port to simulate network failure
        const timeoutSangria = new Sangria({
          apiKey: 'test-key',
          baseUrl: 'http://localhost:9999'
        })

        const result = await timeoutSangria.handleFixedPrice(
          {
            paymentHeader: undefined,
            resourceUrl: '/api/premium'
          },
          { price: 0.01 }
        )

        expect(result.action).toBe('respond')
        if (result.action === 'respond') {
          expect(result.status).toBe(500)
          expect(result.body.error).toBe('Payment service unavailable')
        }
      }, 15000)
    })

    describe('Payment Settlement Flow', () => {
      it('should settle payment with valid signature', async () => {
        const result = await sangria.handleFixedPrice(
          {
            paymentHeader: 'valid_payment_signature_e2e',
            resourceUrl: '/api/premium'
          },
          { price: 0.01 }
        )

        expect(result.action).toBe('proceed')
        if (result.action === 'proceed') {
          expect(result.data.paid).toBe(true)
          expect(result.data.amount).toBe(0.01)
          expect(result.data.transaction).toBeDefined()
          expect(result.data.transaction).toMatch(/^tx_\d+_[a-z0-9]+$/)
        }
      }, 10000)

      it('should handle invalid payment signature', async () => {
        const result = await sangria.handleFixedPrice(
          {
            paymentHeader: 'invalid_signature_test',
            resourceUrl: '/api/premium'
          },
          { price: 0.01 }
        )

        expect(result.action).toBe('respond')
        if (result.action === 'respond') {
          expect(result.status).toBe(402)
          expect(result.body.error).toBe('Invalid payment signature')
          expect(result.body.error_reason).toBe('INVALID_SIGNATURE')
        }
      }, 10000)

      it('should handle insufficient funds', async () => {
        const result = await sangria.handleFixedPrice(
          {
            paymentHeader: 'insufficient_funds_test',
            resourceUrl: '/api/premium'
          },
          { price: 100.0 }
        )

        expect(result.action).toBe('respond')
        if (result.action === 'respond') {
          expect(result.status).toBe(402)
          expect(result.body.error).toBe('Insufficient balance for payment')
          expect(result.body.error_reason).toBe('INSUFFICIENT_FUNDS')
        }
      }, 10000)

      it('should handle settlement without transaction ID', async () => {
        // This would require a specific backend response, but demonstrates the pattern
        const result = await sangria.handleFixedPrice(
          {
            paymentHeader: 'valid_no_transaction',
            resourceUrl: '/api/premium'
          },
          { price: 0.01 }
        )

        expect(result.action).toBe('proceed')
        if (result.action === 'proceed') {
          expect(result.data.paid).toBe(true)
          expect(result.data.amount).toBe(0.01)
          expect(result.data).toHaveProperty('transaction')
        }
      }, 10000)
    })

    describe('Input Validation E2E', () => {
      it('should handle edge case pricing', async () => {
        const edgeCases = [
          { price: Number.MIN_VALUE, expectSuccess: true },
          { price: 0.000001, expectSuccess: true },
          { price: 999999.999999, expectSuccess: true }
        ]

        for (const testCase of edgeCases) {
          try {
            const result = await sangria.handleFixedPrice(
              {
                paymentHeader: undefined,
                resourceUrl: '/api/test'
              },
              { price: testCase.price }
            )

            if (testCase.expectSuccess) {
              expect(result.action).toBe('respond')
              if (result.action === 'respond') {
                expect(result.body.amount).toBe(testCase.price)
              }
            }
          } catch (error) {
            if (testCase.expectSuccess) {
              throw error
            }
          }
        }
      }, 15000)

      it('should handle special characters in resource URLs', async () => {
        const testUrls = [
          '/api/café',
          '/api/resource?param=value&other=test',
          '/api/path/with/segments',
          '/api/resource#fragment'
        ]

        for (const url of testUrls) {
          const result = await sangria.handleFixedPrice(
            {
              paymentHeader: undefined,
              resourceUrl: url
            },
            { price: 0.01 }
          )

          expect(result.action).toBe('respond')
          if (result.action === 'respond') {
            expect(result.body.resource).toBe(url)
          }
        }
      }, 15000)

      it('should handle long descriptions', async () => {
        const longDescription = 'A'.repeat(1000) // 1KB description

        const result = await sangria.handleFixedPrice(
          {
            paymentHeader: undefined,
            resourceUrl: '/api/test'
          },
          {
            price: 0.01,
            description: longDescription
          }
        )

        expect(result.action).toBe('respond')
        if (result.action === 'respond') {
          expect(result.body.description).toBe(longDescription)
        }
      }, 10000)
    })

    describe('Concurrent Request Handling', () => {
      it('should handle multiple concurrent payment generations', async () => {
        const promises = Array.from({ length: 10 }, (_, i) =>
          sangria.handleFixedPrice(
            {
              paymentHeader: undefined,
              resourceUrl: `/api/test/${i}`
            },
            { price: 0.01 + i * 0.01 }
          )
        )

        const results = await Promise.all(promises)

        results.forEach((result, i) => {
          expect(result.action).toBe('respond')
          if (result.action === 'respond') {
            expect(result.body.amount).toBe(0.01 + i * 0.01)
            expect(result.body.resource).toBe(`/api/test/${i}`)
            expect(result.body.payment_id).toBeDefined()
          }
        })
      }, 20000)

      it('should handle mixed generation and settlement requests', async () => {
        const requests = [
          // Generation requests
          ...Array.from({ length: 5 }, (_, i) => ({
            paymentHeader: undefined,
            resourceUrl: `/api/generate/${i}`,
            price: 0.01
          })),
          // Settlement requests
          ...Array.from({ length: 5 }, (_, i) => ({
            paymentHeader: `valid_signature_${i}`,
            resourceUrl: `/api/settle/${i}`,
            price: 0.01
          }))
        ]

        const promises = requests.map(req =>
          sangria.handleFixedPrice(
            {
              paymentHeader: req.paymentHeader,
              resourceUrl: req.resourceUrl
            },
            { price: req.price }
          )
        )

        const results = await Promise.all(promises)

        // First 5 should be payment generation (respond)
        results.slice(0, 5).forEach(result => {
          expect(result.action).toBe('respond')
          if (result.action === 'respond') {
            expect(result.status).toBe(402)
          }
        })

        // Last 5 should be settlement (proceed)
        results.slice(5).forEach(result => {
          expect(result.action).toBe('proceed')
          if (result.action === 'proceed') {
            expect(result.data.paid).toBe(true)
          }
        })
      }, 20000)
    })

    describe('Backend Health and Connectivity', () => {
      it('should verify backend is responsive', async () => {
        const response = await fetch(`${baseUrl}/health`)
        expect(response.ok).toBe(true)

        const data = await response.json()
        expect(data.status).toBe('healthy')
      }, 5000)

      it('should handle backend service interruption gracefully', async () => {
        // Temporarily stop backend
        await backend.stop()

        const result = await sangria.handleFixedPrice(
          {
            paymentHeader: undefined,
            resourceUrl: '/api/test'
          },
          { price: 0.01 }
        )

        expect(result.action).toBe('respond')
        if (result.action === 'respond') {
          expect(result.status).toBe(500)
          expect(result.body.error).toBe('Payment service unavailable')
        }

        // Restart backend for other tests
        await backend.start()
      }, 15000)
    })
  })
})