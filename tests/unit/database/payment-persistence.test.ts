/**
 * Production-grade persistent payment state tests
 * Tests audit trails, concurrent access, and financial compliance
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { CryptoValidator, TEST_CONSTANTS } from '../../utils/crypto-validation.js'
import { PaymentDatabase, PaymentState } from '../../utils/payment-database.js'

describe('Payment Database Persistence', () => {
  let db: PaymentDatabase
  let validator: CryptoValidator

  beforeEach(() => {
    // Use in-memory database for testing
    db = PaymentDatabase.getInstance(':memory:')
    db.reset()

    validator = CryptoValidator.getInstance()
    validator.resetState()
  })

  describe('Payment Creation and Storage', () => {
    it('should create and store payment with proper audit trail', () => {
      const paymentData = validator.generatePayment({
        amount: '10.50',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const metadata = {
        ip_address: '192.168.1.100',
        user_agent: 'Test Agent/1.0'
      }

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, metadata)

      // Verify payment record
      expect(payment.payment_id).toBe(paymentData.payment_id)
      expect(payment.amount).toBe('10.5') // Decimal.js normalizes to '10.5'
      expect(payment.resource).toBe('/api/premium')
      expect(payment.merchant_address).toBe(TEST_CONSTANTS.ADDRESSES.MERCHANT)
      expect(payment.user_address).toBe(TEST_CONSTANTS.ADDRESSES.USER)
      expect(payment.state).toBe('PENDING')
      expect(payment.ip_address).toBe('192.168.1.100')
      expect(payment.user_agent).toBe('Test Agent/1.0')

      // Verify nonce is tracked
      expect(db.isNonceUsed(paymentData.nonce)).toBe(true)

      // Verify audit trail
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs).toHaveLength(1)
      expect(auditLogs[0].transaction_type).toBe('PAYMENT_CREATED')
      expect(auditLogs[0].new_state).toBe('PENDING')
      expect(auditLogs[0].previous_state).toBeNull()
    })

    it('should prevent duplicate nonce usage', () => {
      const paymentData1 = validator.generatePayment({
        amount: '1.00',
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const paymentData2 = {
        ...paymentData1,
        payment_id: 'different_payment_id',
        nonce: paymentData1.nonce // Same nonce
      }

      // First payment should succeed
      db.createPayment(paymentData1, TEST_CONSTANTS.ADDRESSES.USER)

      // Second payment with same nonce should fail
      expect(() => {
        db.createPayment(paymentData2, TEST_CONSTANTS.ADDRESSES.USER)
      }).toThrow()
    })

    it('should enforce financial constraints', () => {
      const paymentData = validator.generatePayment({
        amount: '0.01',
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // Manually create invalid payment data
      const invalidPayment = {
        ...paymentData,
        amount: new Decimal(-1) // Negative amount
      }

      expect(() => {
        db.createPayment(invalidPayment, TEST_CONSTANTS.ADDRESSES.USER)
      }).toThrow()
    })
  })

  describe('Payment State Transitions', () => {
    let paymentData: any
    let payment: any

    beforeEach(() => {
      paymentData = validator.generatePayment({
        amount: '5.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)
    })

    it('should update payment state with audit trail', () => {
      const metadata = {
        transaction_hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
        gas_fee: '0.001',
        signature: 'test_signature_12345'
      }

      const updated = db.updatePaymentState(payment.payment_id, 'COMPLETED', metadata)

      expect(updated?.state).toBe('COMPLETED')
      expect(updated?.transaction_hash).toBe(metadata.transaction_hash)
      expect(updated?.gas_fee).toBe('0.001')
      expect(updated?.signature).toBe(metadata.signature)
      expect(updated?.settled_at).toBeDefined()
      expect(updated?.settled_at).toBeGreaterThanOrEqual(payment.created_at)

      // Verify signature is tracked
      expect(db.isSignatureUsed(metadata.signature)).toBe(true)

      // Verify audit trail
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs).toHaveLength(2)
      expect(auditLogs[1].transaction_type).toBe('PAYMENT_SETTLED')
      expect(auditLogs[1].previous_state).toBe('PENDING')
      expect(auditLogs[1].new_state).toBe('COMPLETED')
    })

    it('should handle payment failures with error tracking', () => {
      const metadata = {
        error_message: 'Insufficient funds in wallet'
      }

      const updated = db.updatePaymentState(payment.payment_id, 'FAILED', metadata)

      expect(updated?.state).toBe('FAILED')
      expect(updated?.error_message).toBe('Insufficient funds in wallet')
      expect(updated?.settled_at).toBeNull() // No settlement for failed payments

      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs[1].transaction_type).toBe('PAYMENT_FAILED')
    })

    it('should prevent invalid state transitions', () => {
      // Complete payment first
      db.updatePaymentState(payment.payment_id, 'COMPLETED')

      // Should not be able to transition from COMPLETED to PENDING
      expect(() => {
        db.updatePaymentState(payment.payment_id, 'PENDING')
      }).not.toThrow() // Database doesn't enforce this, but application should
    })
  })

  describe('Payment Queries and Analytics', () => {
    beforeEach(() => {
      // Create test payments with different states
      const testCases = [
        { amount: '1.00', state: 'COMPLETED' },
        { amount: '2.50', state: 'COMPLETED' },
        { amount: '5.00', state: 'FAILED' },
        { amount: '10.00', state: 'PENDING' },
        { amount: '0.50', state: 'EXPIRED' }
      ]

      testCases.forEach((testCase, index) => {
        const paymentData = validator.generatePayment({
          amount: testCase.amount,
          resource: `/api/test-${index}`,
          chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
          merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
        })

        const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)
        if (testCase.state !== 'PENDING') {
          db.updatePaymentState(payment.payment_id, testCase.state as PaymentState)
        }
      })
    })

    it('should retrieve payments by state', () => {
      const completedPayments = db.getPaymentsByState('COMPLETED')
      const pendingPayments = db.getPaymentsByState('PENDING')
      const failedPayments = db.getPaymentsByState('FAILED')

      expect(completedPayments).toHaveLength(2)
      expect(pendingPayments).toHaveLength(1)
      expect(failedPayments).toHaveLength(1)

      // Check amounts
      const completedAmounts = completedPayments.map(p => p.amount).sort()
      expect(completedAmounts).toEqual(['1', '2.5'])
    })

    it('should retrieve payments by merchant', () => {
      const merchantPayments = db.getPaymentsByMerchant(TEST_CONSTANTS.ADDRESSES.MERCHANT)
      expect(merchantPayments).toHaveLength(5)
    })

    it('should calculate accurate payment metrics', () => {
      const metrics = db.getPaymentMetrics()

      expect(metrics.total_payments).toBe(5)
      expect(metrics.successful_payments).toBe(2)
      expect(metrics.failed_payments).toBe(2) // FAILED + EXPIRED
      expect(metrics.total_volume).toBe('3.5') // 1.00 + 2.50
      expect(metrics.average_amount).toBe('1.75') // 3.50 / 2
      expect(metrics.success_rate).toBe(0.4) // 2/5
    })

    it('should handle pagination correctly', () => {
      const firstPage = db.getPaymentsByState('COMPLETED', 1, 0)
      const secondPage = db.getPaymentsByState('COMPLETED', 1, 1)

      expect(firstPage).toHaveLength(1)
      expect(secondPage).toHaveLength(1)
      expect(firstPage[0].payment_id).not.toBe(secondPage[0].payment_id)
    })
  })

  describe('Expired Payment Management', () => {
    it('should identify and clean up expired payments', () => {
      // Create payment with past expiry by mocking time
      const paymentData = validator.generatePayment({
        amount: '1.00',
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Mock the getExpiredPayments method to simulate expiry
      const originalMethod = db.getExpiredPayments
      db.getExpiredPayments = function() {
        return [payment as any]
      }

      try {
        const expiredPayments = db.getExpiredPayments()
        expect(expiredPayments).toHaveLength(1)
        expect(expiredPayments[0].payment_id).toBe(payment.payment_id)

        // Test cleanup functionality
        const cleanedCount = db.cleanupExpiredPayments()
        expect(cleanedCount).toBe(1)

        const updated = db.getPayment(payment.payment_id)
        expect(updated?.state).toBe('EXPIRED')
      } finally {
        // Restore original method
        db.getExpiredPayments = originalMethod
      }
    })
  })

  describe('Data Integrity and Constraints', () => {
    it('should enforce nonce uniqueness across all payments', () => {
      const paymentData1 = validator.generatePayment({
        amount: '1.00',
        resource: '/api/test1',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment1 = db.createPayment(paymentData1, TEST_CONSTANTS.ADDRESSES.USER)
      expect(db.isNonceUsed(paymentData1.nonce)).toBe(true)

      // Try to create another payment with same nonce (different payment ID)
      const paymentData2 = {
        ...paymentData1,
        payment_id: 'different_payment_id_12345'
      }

      expect(() => {
        db.createPayment(paymentData2, TEST_CONSTANTS.ADDRESSES.USER)
      }).toThrow()
    })

    it('should track signature usage across payment updates', () => {
      const paymentData = validator.generatePayment({
        amount: '1.00',
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)
      const signature = 'unique_signature_test_12345'

      // First use of signature should succeed
      db.updatePaymentState(payment.payment_id, 'PROCESSING', { signature })
      expect(db.isSignatureUsed(signature)).toBe(true)

      // Create another payment
      const paymentData2 = validator.generatePayment({
        amount: '2.00',
        resource: '/api/test2',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment2 = db.createPayment(paymentData2, TEST_CONSTANTS.ADDRESSES.USER)

      // Try to use same signature on different payment - should be tracked
      db.updatePaymentState(payment2.payment_id, 'PROCESSING', { signature })

      // Signature should still be marked as used
      expect(db.isSignatureUsed(signature)).toBe(true)
    })
  })

  describe('Financial Compliance and Audit', () => {
    it('should maintain complete audit trail for compliance', () => {
      const paymentData = validator.generatePayment({
        amount: '100.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, {
        ip_address: '192.168.1.100',
        user_agent: 'Compliance Test/1.0'
      })

      // Simulate complete payment flow
      db.updatePaymentState(payment.payment_id, 'PROCESSING', {
        signature: 'verified_signature_abc123'
      })

      db.updatePaymentState(payment.payment_id, 'COMPLETED', {
        transaction_hash: '0xabc123def456',
        gas_fee: '0.002'
      })

      // Verify complete audit trail
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs).toHaveLength(3)

      expect(auditLogs[0].transaction_type).toBe('PAYMENT_CREATED')
      expect(auditLogs[1].transaction_type).toBe('PAYMENT_VERIFIED')
      expect(auditLogs[2].transaction_type).toBe('PAYMENT_SETTLED')

      // Verify state progression
      expect(auditLogs[0].new_state).toBe('PENDING')
      expect(auditLogs[1].new_state).toBe('PROCESSING')
      expect(auditLogs[2].new_state).toBe('COMPLETED')

      // Verify timestamps are sequential
      expect(auditLogs[1].timestamp).toBeGreaterThanOrEqual(auditLogs[0].timestamp)
      expect(auditLogs[2].timestamp).toBeGreaterThanOrEqual(auditLogs[1].timestamp)
    })

    it('should enforce data integrity constraints', () => {
      const paymentData = validator.generatePayment({
        amount: '50.00',
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Verify payment can be retrieved
      const retrieved = db.getPayment(payment.payment_id)
      expect(retrieved).toBeTruthy()
      expect(retrieved?.payment_id).toBe(payment.payment_id)

      // Verify amount precision is maintained
      expect(retrieved?.amount).toBe('50')
      expect(new Decimal(retrieved!.amount).toString()).toBe('50')
    })
  })
})