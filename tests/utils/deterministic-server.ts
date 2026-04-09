/**
 * Deterministic Test Server
 * Replaces the non-deterministic MockServer with predictable behavior
 * for reliable financial software testing
 */

import express from 'express'
import { ethers } from 'ethers'

export interface PaymentRecord {
  paymentId: string
  paymentHeader: string
  amount: string
  resource: string
  from?: string
  to?: string
  nonce?: string
  signature?: string
  status: 'pending' | 'verified' | 'settled' | 'failed' | 'expired'
  createdAt: number
  updatedAt: number
  transactionHash?: string
  errorReason?: string
}

export interface ServerState {
  payments: Map<string, PaymentRecord>
  usedNonces: Set<string>
  balances: Map<string, string> // wallet address -> USDC balance
  rateLimits: Map<string, number[]> // IP -> request timestamps
}

export class DeterministicSangriaServer {
  private app: express.Application
  private server: any
  private state: ServerState
  private facilitatorDomain: any
  private transferWithAuthType: any

  constructor(
    private port = 8080,
    private options = {
      enableRateLimit: true,
      enableAuth: true,
      enableSignatureValidation: true
    }
  ) {
    this.app = express()
    this.server = null
    this.state = {
      payments: new Map(),
      usedNonces: new Set(),
      balances: new Map([
        // Pre-fund test wallets with deterministic amounts
        ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase(), '1000000000'], // 1000 USDC
        ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'.toLowerCase(), '500000000'], // 500 USDC
        ['0x90F79bf6EB2c4f870365E785982E1f101E93b906'.toLowerCase(), '100000000'], // 100 USDC
        ['0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'.toLowerCase(), '0'] // Empty wallet
      ]),
      rateLimits: new Map()
    }

    // EIP-712 domain for signature validation
    this.facilitatorDomain = {
      name: 'USD Coin',
      version: '2',
      chainId: 84532, // Base Sepolia
      verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
    }

    this.transferWithAuthType = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' }
      ]
    }

    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware() {
    this.app.use(express.json())

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-API-Key, X-Payment')
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200)
      }
      next()
    })

    // Rate limiting (deterministic)
    if (this.options.enableRateLimit) {
      this.app.use((req, res, next) => {
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown'
        const now = Date.now()
        const windowMs = 60000 // 1 minute
        const maxRequests = 100 // Per minute

        if (!this.state.rateLimits.has(clientIp)) {
          this.state.rateLimits.set(clientIp, [])
        }

        const requests = this.state.rateLimits.get(clientIp)!

        // Remove old requests
        const recentRequests = requests.filter(time => now - time < windowMs)

        if (recentRequests.length >= maxRequests) {
          return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: Math.ceil((recentRequests[0] + windowMs - now) / 1000)
          })
        }

        recentRequests.push(now)
        this.state.rateLimits.set(clientIp, recentRequests)
        next()
      })
    }

    // Error handler
    this.app.use((error: any, req: any, res: any, next: any) => {
      console.error('Server error:', error)
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        })
      }
    })
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: Math.floor(Date.now() / 1000),
        version: '1.0.0-deterministic',
        uptime: process.uptime()
      })
    })

    // Generate payment
    this.app.post('/api/v1/payments/generate', (req, res) => {
      try {
        const { amount, resource, description } = req.body

        // Validate input
        if (!amount || typeof amount !== 'number' || amount <= 0) {
          return res.status(400).json({
            error: 'Invalid amount',
            details: 'Amount must be a positive number'
          })
        }

        if (!resource || typeof resource !== 'string') {
          return res.status(400).json({
            error: 'Invalid resource',
            details: 'Resource URL is required'
          })
        }

        // Convert decimal amount to USDC base units (6 decimals)
        const valueInBaseUnits = ethers.parseUnits(amount.toString(), 6)

        // Generate deterministic payment ID
        const paymentId = `payment_${Date.now()}_${this.state.payments.size}`
        const paymentHeader = `header_${paymentId}`

        const payment: PaymentRecord = {
          paymentId,
          paymentHeader,
          amount: valueInBaseUnits.toString(),
          resource,
          status: 'pending',
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000)
        }

        this.state.payments.set(paymentId, payment)

        res.json({
          payment_id: paymentId,
          payment_header: paymentHeader,
          challenge: `challenge-${paymentId}`,
          amount: valueInBaseUnits.toString(),
          resource,
          timestamp: payment.createdAt,
          expires_at: payment.createdAt + 300, // 5 minutes
          facilitator_url: 'http://localhost:8080'
        })
      } catch (error: any) {
        res.status(400).json({
          error: 'Invalid request',
          details: error.message
        })
      }
    })

    // Verify payment
    this.app.post('/api/v1/payments/verify', (req, res) => {
      try {
        const { payment_header, signature, from, to, value, validAfter, validBefore, nonce } = req.body

        // Find payment by header
        let payment: PaymentRecord | undefined
        for (const p of this.state.payments.values()) {
          if (p.paymentHeader === payment_header) {
            payment = p
            break
          }
        }

        if (!payment) {
          return res.status(404).json({
            success: false,
            error: 'Payment not found'
          })
        }

        // Basic validation
        if (!signature || !from || !to || !value || !nonce) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields'
          })
        }

        // Check nonce reuse
        if (this.state.usedNonces.has(nonce)) {
          return res.status(400).json({
            success: false,
            error: 'Nonce already used',
            reason: 'NONCE_REUSED'
          })
        }

        // Check time bounds
        const now = Math.floor(Date.now() / 1000)
        if (validAfter > now) {
          return res.status(400).json({
            success: false,
            error: 'Payment not yet valid',
            reason: 'NOT_YET_VALID'
          })
        }

        if (validBefore <= now) {
          return res.status(400).json({
            success: false,
            error: 'Payment expired',
            reason: 'EXPIRED'
          })
        }

        // Validate signature (if enabled)
        if (this.options.enableSignatureValidation) {
          try {
            const paymentData = { from, to, value, validAfter, validBefore, nonce }
            const recovered = ethers.verifyTypedData(
              this.facilitatorDomain,
              this.transferWithAuthType,
              paymentData,
              signature
            )

            if (recovered.toLowerCase() !== from.toLowerCase()) {
              return res.status(400).json({
                success: false,
                error: 'Invalid signature',
                reason: 'INVALID_SIGNATURE'
              })
            }
          } catch (error) {
            return res.status(400).json({
              success: false,
              error: 'Signature verification failed',
              reason: 'SIGNATURE_VERIFICATION_FAILED'
            })
          }
        }

        // Check balance
        const balance = this.state.balances.get(from.toLowerCase()) || '0'
        if (BigInt(balance) < BigInt(value)) {
          return res.status(400).json({
            success: false,
            error: 'Insufficient balance',
            reason: 'INSUFFICIENT_FUNDS',
            available: balance,
            required: value
          })
        }

        // Update payment
        payment.from = from
        payment.to = to
        payment.nonce = nonce
        payment.signature = signature
        payment.status = 'verified'
        payment.updatedAt = now

        this.state.payments.set(payment.paymentId, payment)

        res.json({
          success: true,
          payment_id: payment.paymentId,
          verified_at: now
        })
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: 'Verification failed',
          details: error.message
        })
      }
    })

    // Settle payment
    this.app.post('/api/v1/payments/settle', (req, res) => {
      try {
        const { payment_header, payment_id } = req.body

        // Auth check
        if (this.options.enableAuth) {
          const authHeader = req.headers.authorization
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
              error: 'Invalid API key'
            })
          }
        }

        // Find payment
        let payment: PaymentRecord | undefined
        if (payment_id) {
          payment = this.state.payments.get(payment_id)
        } else if (payment_header) {
          for (const p of this.state.payments.values()) {
            if (p.paymentHeader === payment_header) {
              payment = p
              break
            }
          }
        }

        if (!payment) {
          return res.status(404).json({
            success: false,
            error: 'Payment not found'
          })
        }

        if (payment.status !== 'verified') {
          return res.status(400).json({
            success: false,
            error: `Payment not verified (status: ${payment.status})`
          })
        }

        // Simulate settlement
        const transactionHash = `0x${payment.paymentId.replace('payment_', '')}`

        // Update balances
        if (payment.from && payment.to) {
          const fromBalance = BigInt(this.state.balances.get(payment.from.toLowerCase()) || '0')
          const toBalance = BigInt(this.state.balances.get(payment.to.toLowerCase()) || '0')
          const amount = BigInt(payment.amount)

          this.state.balances.set(payment.from.toLowerCase(), (fromBalance - amount).toString())
          this.state.balances.set(payment.to.toLowerCase(), (toBalance + amount).toString())
        }

        // Mark nonce as used
        if (payment.nonce) {
          this.state.usedNonces.add(payment.nonce)
        }

        // Update payment
        payment.status = 'settled'
        payment.transactionHash = transactionHash
        payment.updatedAt = Math.floor(Date.now() / 1000)

        this.state.payments.set(payment.paymentId, payment)

        res.json({
          success: true,
          transaction: transactionHash,
          amount: payment.amount,
          timestamp: payment.updatedAt,
          confirmation_url: `https://sepolia.basescan.org/tx/${transactionHash}`,
          gas_fee: '1000', // 0.001 USDC gas fee
          network: 'base-sepolia'
        })
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: 'Settlement failed',
          details: error.message
        })
      }
    })

    // Test premium content endpoint
    this.app.get('/api/premium', (req, res) => {
      const paymentHeader = req.headers['x-payment']

      if (!paymentHeader) {
        return res.status(402).json({
          error: 'Payment required',
          payment_required: true
        })
      }

      // Find payment by header
      let payment: PaymentRecord | undefined
      for (const p of this.state.payments.values()) {
        if (p.paymentHeader === paymentHeader) {
          payment = p
          break
        }
      }

      if (!payment || payment.status !== 'settled') {
        return res.status(402).json({
          error: 'Invalid or unsettled payment',
          payment_required: true
        })
      }

      res.json({
        content: 'Premium content - access granted',
        paid: true,
        payment_id: payment.paymentId,
        transaction_hash: payment.transactionHash
      })
    })

    // Merchant balance endpoint
    this.app.get('/api/v1/merchant/balance', (req, res) => {
      // In a real implementation, this would be merchant-specific
      const totalSettled = Array.from(this.state.payments.values())
        .filter(p => p.status === 'settled')
        .reduce((total, p) => total + BigInt(p.amount), BigInt('0'))

      res.json({
        balance: ethers.formatUnits(totalSettled.toString(), 6),
        pending: '0.00',
        currency: 'USDC',
        last_updated: Math.floor(Date.now() / 1000),
        total_transactions: this.state.payments.size
      })
    })

    // Debug endpoints (only in test mode)
    this.app.get('/debug/state', (req, res) => {
      res.json({
        payments: Object.fromEntries(this.state.payments),
        usedNonces: Array.from(this.state.usedNonces),
        balances: Object.fromEntries(this.state.balances),
        totalRequests: Array.from(this.state.rateLimits.values()).reduce((sum, arr) => sum + arr.length, 0)
      })
    })

    this.app.post('/debug/reset', (req, res) => {
      this.resetState()
      res.json({ message: 'State reset successfully' })
    })
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err?: Error) => {
        if (err) {
          reject(err)
        } else {
          console.log(`Deterministic Sangria server running on port ${this.port}`)
          resolve()
        }
      })
    })
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Deterministic server stopped')
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
  getBaseUrl(): string {
    return `http://localhost:${this.port}`
  }

  /**
   * Reset server state for clean testing
   */
  resetState(): void {
    this.state.payments.clear()
    this.state.usedNonces.clear()
    this.state.rateLimits.clear()

    // Reset balances to initial state
    this.state.balances.clear()
    this.state.balances.set('0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase(), '1000000000')
    this.state.balances.set('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'.toLowerCase(), '500000000')
    this.state.balances.set('0x90F79bf6EB2c4f870365E785982E1f101E93b906'.toLowerCase(), '100000000')
    this.state.balances.set('0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'.toLowerCase(), '0')
  }

  /**
   * Get server state for testing
   */
  getState(): ServerState {
    return this.state
  }

  /**
   * Set balance for testing
   */
  setBalance(address: string, balance: string): void {
    this.state.balances.set(address.toLowerCase(), balance)
  }

  /**
   * Add used nonce for testing
   */
  addUsedNonce(nonce: string): void {
    this.state.usedNonces.add(nonce)
  }
}