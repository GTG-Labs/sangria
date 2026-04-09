/**
 * Production-grade persistent payment state management
 * Implements audit trails, concurrent access, and financial compliance
 */

import Database from 'better-sqlite3'
import Decimal from 'decimal.js'
import { PaymentData, PaymentSignature } from './crypto-validation.js'

export type PaymentState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
export type TransactionType = 'PAYMENT_CREATED' | 'PAYMENT_VERIFIED' | 'PAYMENT_SETTLED' | 'PAYMENT_FAILED' | 'PAYMENT_EXPIRED'

export interface PaymentRecord {
  payment_id: string
  amount: string // Decimal as string for precision
  resource: string
  merchant_address: string
  user_address: string
  chain_id: number
  nonce: string
  signature?: string
  state: PaymentState
  created_at: number
  updated_at: number
  expires_at: number
  settled_at?: number
  transaction_hash?: string
  gas_fee?: string
  error_message?: string
  ip_address?: string
  user_agent?: string
}

export interface AuditLog {
  id: number
  payment_id: string
  transaction_type: TransactionType
  previous_state?: PaymentState
  new_state: PaymentState
  timestamp: number
  metadata?: string
  ip_address?: string
  user_agent?: string
}

export interface PaymentMetrics {
  total_payments: number
  total_volume: string
  successful_payments: number
  failed_payments: number
  average_amount: string
  success_rate: number
}

export class PaymentDatabase {
  private db: Database.Database
  private static instance: PaymentDatabase

  private constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath)
    this.initializeTables()
    this.setupIndices()
  }

  static getInstance(dbPath?: string): PaymentDatabase {
    if (!PaymentDatabase.instance) {
      PaymentDatabase.instance = new PaymentDatabase(dbPath)
    }
    return PaymentDatabase.instance
  }

  /**
   * Initialize database schema for financial compliance
   */
  private initializeTables() {
    // Payments table with financial precision
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        payment_id TEXT PRIMARY KEY,
        amount TEXT NOT NULL CHECK(amount LIKE '%.%' OR amount NOT LIKE '%.%'),
        resource TEXT NOT NULL,
        merchant_address TEXT NOT NULL,
        user_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        nonce TEXT UNIQUE NOT NULL,
        signature TEXT,
        state TEXT NOT NULL CHECK(state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        settled_at INTEGER,
        transaction_hash TEXT,
        gas_fee TEXT,
        error_message TEXT,
        ip_address TEXT,
        user_agent TEXT,

        -- Financial constraints
        CHECK(CAST(amount AS REAL) > 0),
        CHECK(expires_at > created_at),
        CHECK(settled_at IS NULL OR settled_at >= created_at)
      )
    `)

    // Audit trail for compliance
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN (
          'PAYMENT_CREATED', 'PAYMENT_VERIFIED', 'PAYMENT_SETTLED',
          'PAYMENT_FAILED', 'PAYMENT_EXPIRED'
        )),
        previous_state TEXT,
        new_state TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT,
        ip_address TEXT,
        user_agent TEXT,

        FOREIGN KEY(payment_id) REFERENCES payments(payment_id) ON DELETE CASCADE
      )
    `)

    // Used nonces for replay protection
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS used_nonces (
        nonce TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,

        FOREIGN KEY(payment_id) REFERENCES payments(payment_id) ON DELETE CASCADE
      )
    `)

    // Used signatures for replay protection
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS used_signatures (
        signature_hash TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,

        FOREIGN KEY(payment_id) REFERENCES payments(payment_id) ON DELETE CASCADE
      )
    `)
  }

  /**
   * Create database indices for performance
   */
  private setupIndices() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_payments_state ON payments(state);
      CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_address);
      CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
      CREATE INDEX IF NOT EXISTS idx_payments_expires_at ON payments(expires_at);
      CREATE INDEX IF NOT EXISTS idx_payments_amount ON payments(CAST(amount AS REAL));
      CREATE INDEX IF NOT EXISTS idx_audit_logs_payment_id ON audit_logs(payment_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_used_nonces_created_at ON used_nonces(created_at);
    `)
  }

  /**
   * Create a new payment with audit trail
   */
  createPayment(paymentData: PaymentData, userAddress: string, metadata?: any): PaymentRecord {
    const now = Math.floor(Date.now() / 1000)

    const payment: PaymentRecord = {
      payment_id: paymentData.payment_id,
      amount: paymentData.amount.toString(),
      resource: paymentData.resource,
      merchant_address: paymentData.merchant_address,
      user_address: userAddress,
      chain_id: paymentData.chain_id,
      nonce: paymentData.nonce,
      state: 'PENDING',
      created_at: now,
      updated_at: now,
      expires_at: paymentData.expires_at,
      ip_address: metadata?.ip_address,
      user_agent: metadata?.user_agent
    }

    // Start transaction for atomicity
    const transaction = this.db.transaction(() => {
      // Insert payment
      const insertPayment = this.db.prepare(`
        INSERT INTO payments (
          payment_id, amount, resource, merchant_address, user_address,
          chain_id, nonce, state, created_at, updated_at, expires_at,
          ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      insertPayment.run(
        payment.payment_id, payment.amount, payment.resource,
        payment.merchant_address, payment.user_address, payment.chain_id,
        payment.nonce, payment.state, payment.created_at, payment.updated_at,
        payment.expires_at, payment.ip_address, payment.user_agent
      )

      // Record nonce usage
      const insertNonce = this.db.prepare(`
        INSERT INTO used_nonces (nonce, payment_id, created_at) VALUES (?, ?, ?)
      `)
      insertNonce.run(payment.nonce, payment.payment_id, now)

      // Create audit log
      this.createAuditLog(
        payment.payment_id,
        'PAYMENT_CREATED',
        undefined,
        'PENDING',
        metadata
      )
    })

    transaction()
    return payment
  }

  /**
   * Update payment state with atomic transaction and audit
   */
  updatePaymentState(
    paymentId: string,
    newState: PaymentState,
    metadata?: any
  ): PaymentRecord | null {
    const current = this.getPayment(paymentId)
    if (!current) {
      throw new Error('Payment not found')
    }

    const now = Math.floor(Date.now() / 1000)
    const updates: any = {
      state: newState,
      updated_at: now
    }

    // Set settled timestamp for completed payments
    if (newState === 'COMPLETED' && !current.settled_at) {
      updates.settled_at = now
    }

    // Add additional metadata
    if (metadata?.transaction_hash) {
      updates.transaction_hash = metadata.transaction_hash
    }
    if (metadata?.gas_fee) {
      updates.gas_fee = metadata.gas_fee.toString()
    }
    if (metadata?.error_message) {
      updates.error_message = metadata.error_message
    }
    if (metadata?.signature) {
      updates.signature = metadata.signature
    }

    const transaction = this.db.transaction(() => {
      // Update payment
      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ')
      const updatePayment = this.db.prepare(`
        UPDATE payments SET ${setClause} WHERE payment_id = ?
      `)
      updatePayment.run(...Object.values(updates), paymentId)

      // Record signature usage if provided
      if (metadata?.signature) {
        const signatureHash = require('crypto')
          .createHash('sha256')
          .update(metadata.signature)
          .digest('hex')

        const insertSignature = this.db.prepare(`
          INSERT OR IGNORE INTO used_signatures (signature_hash, payment_id, created_at)
          VALUES (?, ?, ?)
        `)
        insertSignature.run(signatureHash, paymentId, now)
      }

      // Create audit log
      this.createAuditLog(
        paymentId,
        this.getTransactionTypeFromState(newState),
        current.state,
        newState,
        metadata
      )
    })

    transaction()
    return this.getPayment(paymentId)
  }

  /**
   * Get payment by ID
   */
  getPayment(paymentId: string): PaymentRecord | null {
    const query = this.db.prepare('SELECT * FROM payments WHERE payment_id = ?')
    return query.get(paymentId) as PaymentRecord | null
  }

  /**
   * Check if nonce is already used
   */
  isNonceUsed(nonce: string): boolean {
    const query = this.db.prepare('SELECT 1 FROM used_nonces WHERE nonce = ?')
    return query.get(nonce) !== undefined
  }

  /**
   * Check if signature is already used
   */
  isSignatureUsed(signature: string): boolean {
    const signatureHash = require('crypto')
      .createHash('sha256')
      .update(signature)
      .digest('hex')

    const query = this.db.prepare('SELECT 1 FROM used_signatures WHERE signature_hash = ?')
    return query.get(signatureHash) !== undefined
  }

  /**
   * Get payments by state with pagination
   */
  getPaymentsByState(
    state: PaymentState,
    limit: number = 100,
    offset: number = 0
  ): PaymentRecord[] {
    const query = this.db.prepare(`
      SELECT * FROM payments
      WHERE state = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    return query.all(state, limit, offset) as PaymentRecord[]
  }

  /**
   * Get payments by merchant
   */
  getPaymentsByMerchant(
    merchantAddress: string,
    limit: number = 100,
    offset: number = 0
  ): PaymentRecord[] {
    const query = this.db.prepare(`
      SELECT * FROM payments
      WHERE merchant_address = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    return query.all(merchantAddress, limit, offset) as PaymentRecord[]
  }

  /**
   * Get expired payments for cleanup
   */
  getExpiredPayments(): PaymentRecord[] {
    const now = Math.floor(Date.now() / 1000)
    const query = this.db.prepare(`
      SELECT * FROM payments
      WHERE expires_at < ? AND state = 'PENDING'
    `)
    return query.all(now) as PaymentRecord[]
  }

  /**
   * Get audit logs for a payment
   */
  getPaymentAuditLogs(paymentId: string): AuditLog[] {
    const query = this.db.prepare(`
      SELECT * FROM audit_logs
      WHERE payment_id = ?
      ORDER BY timestamp ASC
    `)
    return query.all(paymentId) as AuditLog[]
  }

  /**
   * Get payment metrics for analytics
   */
  getPaymentMetrics(
    startTime?: number,
    endTime?: number,
    merchantAddress?: string
  ): PaymentMetrics {
    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (startTime) {
      whereClause += ' AND created_at >= ?'
      params.push(startTime)
    }
    if (endTime) {
      whereClause += ' AND created_at <= ?'
      params.push(endTime)
    }
    if (merchantAddress) {
      whereClause += ' AND merchant_address = ?'
      params.push(merchantAddress)
    }

    const query = this.db.prepare(`
      SELECT
        COUNT(*) as total_payments,
        SUM(CASE WHEN state = 'COMPLETED' THEN 1 ELSE 0 END) as successful_payments,
        SUM(CASE WHEN state IN ('FAILED', 'EXPIRED', 'CANCELLED') THEN 1 ELSE 0 END) as failed_payments,
        SUM(CASE WHEN state = 'COMPLETED' THEN CAST(amount AS REAL) ELSE 0 END) as total_volume,
        AVG(CASE WHEN state = 'COMPLETED' THEN CAST(amount AS REAL) ELSE NULL END) as average_amount
      FROM payments
      ${whereClause}
    `)

    const result = query.get(...params) as any
    const successRate = result.total_payments > 0
      ? (result.successful_payments / result.total_payments)
      : 0

    return {
      total_payments: result.total_payments || 0,
      total_volume: (result.total_volume || 0).toString(),
      successful_payments: result.successful_payments || 0,
      failed_payments: result.failed_payments || 0,
      average_amount: (result.average_amount || 0).toString(),
      success_rate: successRate
    }
  }

  /**
   * Clean up expired payments
   */
  cleanupExpiredPayments(): number {
    const expiredPayments = this.getExpiredPayments()
    let cleanedCount = 0

    for (const payment of expiredPayments) {
      this.updatePaymentState(payment.payment_id, 'EXPIRED')
      cleanedCount++
    }

    return cleanedCount
  }

  /**
   * Create audit log entry
   */
  private createAuditLog(
    paymentId: string,
    transactionType: TransactionType,
    previousState: PaymentState | undefined,
    newState: PaymentState,
    metadata?: any
  ) {
    const insertLog = this.db.prepare(`
      INSERT INTO audit_logs (
        payment_id, transaction_type, previous_state, new_state,
        timestamp, metadata, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    insertLog.run(
      paymentId,
      transactionType,
      previousState,
      newState,
      Math.floor(Date.now() / 1000),
      metadata ? JSON.stringify(metadata) : null,
      metadata?.ip_address,
      metadata?.user_agent
    )
  }

  /**
   * Get transaction type from state change
   */
  private getTransactionTypeFromState(state: PaymentState): TransactionType {
    switch (state) {
      case 'COMPLETED': return 'PAYMENT_SETTLED'
      case 'FAILED': return 'PAYMENT_FAILED'
      case 'EXPIRED': return 'PAYMENT_EXPIRED'
      case 'PROCESSING': return 'PAYMENT_VERIFIED'
      default: return 'PAYMENT_CREATED'
    }
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close()
  }

  /**
   * Reset database for testing
   */
  reset() {
    this.db.exec('DELETE FROM payments')
    this.db.exec('DELETE FROM audit_logs')
    this.db.exec('DELETE FROM used_nonces')
    this.db.exec('DELETE FROM used_signatures')
  }
}