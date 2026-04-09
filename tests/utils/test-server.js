/**
 * Test server utilities for mock backend and framework testing
 */
import express from 'express'
import { mockResponses, responseDelays } from '../fixtures/mock-backend/responses.js'

/**
 * Creates a mock Sangria backend server for testing
 */
export class MockSangriaServer {
  constructor(port = 8080, options = {}) {
    this.port = port
    this.app = express()
    this.server = null
    this.requestCount = 0
    this.options = {
      latency: 0,
      errorRate: 0,
      rateLimitThreshold: null, // If set, rate limit after this many requests
      ...options
    }

    this.setupMiddleware()
    this.setupRoutes()
  }

  setupMiddleware() {
    this.app.use(express.json())

    // Add artificial latency if configured
    if (this.options.latency > 0) {
      this.app.use((req, res, next) => {
        setTimeout(next, this.options.latency)
      })
    }

    // Add random errors if configured
    if (this.options.errorRate > 0) {
      this.app.use((req, res, next) => {
        if (Math.random() < this.options.errorRate) {
          return res.status(500).json(mockResponses.generatePayment.server_error())
        }
        next()
      })
    }

    // CORS for testing
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key')
      next()
    })
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json(mockResponses.health.healthy())
    })

    // Generate payment
    this.app.post('/api/v1/payments/generate', (req, res) => {
      const { amount, resource, description } = req.body

      // Validate request
      if (!amount || amount <= 0) {
        return res.status(400).json(mockResponses.generatePayment.validation_error('Invalid amount'))
      }

      if (!resource) {
        return res.status(400).json(mockResponses.generatePayment.validation_error('Resource URL required'))
      }

      // Deterministic rate limiting (if configured)
      this.requestCount++
      if (this.options.rateLimitThreshold && this.requestCount > this.options.rateLimitThreshold) {
        return res.status(429).json(mockResponses.generatePayment.rate_limited())
      }

      // Random rate limiting (legacy)
      if (!this.options.rateLimitThreshold && Math.random() < 0.05) {
        return res.status(429).json(mockResponses.generatePayment.rate_limited())
      }

      // Success response
      res.json(mockResponses.generatePayment.success(amount, resource))
    })

    // Settle payment
    this.app.post('/api/v1/payments/settle', (req, res) => {
      const { payment_header, amount, resource } = req.body
      const authHeader = req.headers.authorization

      // Validate auth
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Invalid API key' })
      }

      // Validate payment header
      if (!payment_header) {
        return res.status(400).json(mockResponses.generatePayment.validation_error('Payment header required'))
      }

      // Simulate different payment outcomes
      const scenario = this.getPaymentScenario(payment_header)

      switch (scenario) {
        case 'success':
          res.json(mockResponses.settlePayment.success(amount))
          break
        case 'invalid_signature':
          res.status(402).json(mockResponses.settlePayment.invalid_signature())
          break
        case 'insufficient_funds':
          res.status(402).json(mockResponses.settlePayment.insufficient_funds())
          break
        case 'expired':
          res.status(402).json(mockResponses.settlePayment.expired_payment())
          break
        case 'network_error':
          res.status(503).json(mockResponses.settlePayment.network_error())
          break
        default:
          res.json(mockResponses.settlePayment.success(amount))
      }
    })

    // Test premium content endpoint
    this.app.get('/api/premium', (req, res) => {
      const paymentHeader = req.headers['x-payment']
      if (!paymentHeader) {
        return res.status(402).json({ error: 'Payment required' })
      }
      res.json({ content: 'Premium content', paid: true })
    })

    // Merchant endpoints
    this.app.get('/api/v1/merchant/balance', (req, res) => {
      res.json({
        balance: 125.50,
        pending: 12.25,
        currency: 'USDC',
        last_updated: Math.floor(Date.now() / 1000)
      })
    })

    // Error handler
    this.app.use((error, req, res, next) => {
      console.error('Mock server error:', error)
      if (!res.headersSent) {
        res.status(500).json(mockResponses.generatePayment.server_error())
      }
    })
  }

  /**
   * Determines payment scenario based on payment header
   */
  getPaymentScenario(paymentHeader) {
    if (paymentHeader.includes('invalid')) return 'invalid_signature'
    if (paymentHeader.includes('insufficient')) return 'insufficient_funds'
    if (paymentHeader.includes('expired')) return 'expired'
    if (paymentHeader.includes('network-error')) return 'network_error'
    return 'success'
  }

  /**
   * Start the mock server
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err) => {
        if (err) {
          reject(err)
        } else {
          console.log(`Mock Sangria server running on port ${this.port}`)
          resolve()
        }
      })
    })
  }

  /**
   * Stop the mock server
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Mock server stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * Get the base URL of the server
   */
  getBaseUrl() {
    return `http://localhost:${this.port}`
  }

  /**
   * Reset request count for deterministic testing
   */
  resetRequestCount() {
    this.requestCount = 0
  }
}

/**
 * Test framework server helpers
 */
export class FrameworkTestServers {
  constructor() {
    this.servers = new Map()
  }

  async startExpress(port = 3001) {
    const app = express()
    app.use(express.json())

    // Test routes that require payment
    app.get('/api/premium', (req, res) => {
      const paymentHeader = req.headers['x-payment']
      if (!paymentHeader) {
        return res.status(402).json({ error: 'Payment required' })
      }
      res.json({ content: 'Premium content', paid: true })
    })

    const server = app.listen(port)
    this.servers.set('express', server)
    return server
  }

  async stopAll() {
    for (const [name, server] of this.servers) {
      await new Promise(resolve => server.close(resolve))
    }
    this.servers.clear()
  }
}