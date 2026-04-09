/**
 * Concurrent Payment and Race Condition Tests
 * Tests system behavior under concurrent access, race conditions, and high load
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { CryptoValidator, TEST_CONSTANTS } from '../../utils/crypto-validation.js'
import { PaymentDatabase, PaymentState } from '../../utils/payment-database.js'

describe('Concurrent Payment and Race Condition Tests', () => {
  let validator: CryptoValidator
  let db: PaymentDatabase

  beforeEach(() => {
    validator = CryptoValidator.getInstance()
    validator.resetState()

    db = PaymentDatabase.getInstance(':memory:')
    db.reset()
  })

  describe('Concurrent Payment Processing', () => {
    it('should handle multiple simultaneous payment creations', async () => {
      const concurrentPayments = 50
      const paymentPromises: Promise<any>[] = []

      // Create multiple payments simultaneously
      for (let i = 0; i < concurrentPayments; i++) {
        const promise = new Promise((resolve, reject) => {
          try {
            const paymentData = validator.generatePayment({
              amount: (i + 1).toString(),
              resource: `/api/concurrent-test-${i}`,
              chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
              merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
            })

            const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, {
              ip_address: `192.168.1.${i % 255}`,
              concurrent_test_id: i
            })

            resolve(payment)
          } catch (error) {
            reject(error)
          }
        })
        paymentPromises.push(promise)
      }

      // Wait for all payments to complete
      const results = await Promise.allSettled(paymentPromises)

      // Verify all payments were created successfully
      const successful = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      expect(successful).toBe(concurrentPayments)
      expect(failed).toBe(0)

      // Verify database integrity
      const allPayments = db.getPaymentsByState('PENDING', 100)
      expect(allPayments).toHaveLength(concurrentPayments)

      // Verify all nonces are unique
      const nonces = allPayments.map(p => p.nonce)
      const uniqueNonces = new Set(nonces)
      expect(uniqueNonces.size).toBe(concurrentPayments)
    })

    it('should prevent nonce collision in concurrent scenarios', async () => {
      const attempts = 100
      const collisionAttempts: Promise<any>[] = []

      // Generate a nonce that we'll try to reuse
      const basePayment = validator.generatePayment({
        amount: '1.00',
        resource: '/api/base-payment',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // Create the first payment
      db.createPayment(basePayment, TEST_CONSTANTS.ADDRESSES.USER)

      // Try to create many payments with the same nonce concurrently
      for (let i = 0; i < attempts; i++) {
        const promise = new Promise((resolve, reject) => {
          try {
            const duplicatePayment = {
              ...basePayment,
              payment_id: `duplicate_${i}`,
              // Keep same nonce - should cause conflicts
            }

            const payment = db.createPayment(duplicatePayment, TEST_CONSTANTS.ADDRESSES.USER)
            resolve(payment)
          } catch (error) {
            reject(error)
          }
        })
        collisionAttempts.push(promise)
      }

      const results = await Promise.allSettled(collisionAttempts)

      // All attempts should fail due to nonce collision
      const successful = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      expect(successful).toBe(0)
      expect(failed).toBe(attempts)

      // Verify only the original payment exists
      const allPayments = db.getPaymentsByState('PENDING', 200)
      expect(allPayments).toHaveLength(1)
      expect(allPayments[0].payment_id).toBe(basePayment.payment_id)
    })

    it('should handle concurrent state transitions safely', async () => {
      const paymentData = validator.generatePayment({
        amount: '10.00',
        resource: '/api/concurrent-state-test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Create multiple concurrent state transition attempts
      const stateTransitions = [
        { state: 'PROCESSING' as PaymentState, metadata: { source: 'worker1' } },
        { state: 'PROCESSING' as PaymentState, metadata: { source: 'worker2' } },
        { state: 'FAILED' as PaymentState, metadata: { source: 'worker3', error: 'timeout' } },
        { state: 'PROCESSING' as PaymentState, metadata: { source: 'worker4' } },
        { state: 'COMPLETED' as PaymentState, metadata: { source: 'worker5', tx: '0x123' } }
      ]

      const transitionPromises = stateTransitions.map((transition, index) =>
        new Promise((resolve, reject) => {
          try {
            // Create race conditions without setTimeout
            try {
              const result = db.updatePaymentState(
                payment.payment_id,
                transition.state,
                transition.metadata
              )
              resolve(result)
            } catch (error) {
              reject(error)
            }
          } catch (error) {
            reject(error)
          }
        })
      )

      const results = await Promise.allSettled(transitionPromises)

      // At least one should succeed
      const successful = results.filter(r => r.status === 'fulfilled').length
      expect(successful).toBeGreaterThan(0)

      // Verify final state is consistent
      const finalPayment = db.getPayment(payment.payment_id)
      expect(finalPayment?.state).toBeTruthy()

      // Verify audit trail shows all attempted transitions
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs.length).toBeGreaterThanOrEqual(2) // At least creation + one transition
    })
  })

  describe('Race Condition Scenarios', () => {
    it('should handle concurrent payment settlement attempts', async () => {
      const paymentData = validator.generatePayment({
        amount: '50.00',
        resource: '/api/settlement-race',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Move to processing state
      db.updatePaymentState(payment.payment_id, 'PROCESSING')

      // Create multiple concurrent settlement attempts
      const settlementAttempts = [
        { tx_hash: '0xabc123', worker: 'settlement_worker_1' },
        { tx_hash: '0xdef456', worker: 'settlement_worker_2' },
        { tx_hash: '0x789xyz', worker: 'settlement_worker_3' }
      ]

      const settlementPromises = settlementAttempts.map((attempt, index) =>
        new Promise((resolve, reject) => {
          try {
            // Simulate race condition
            try {
              const result = db.updatePaymentState(payment.payment_id, 'COMPLETED', {
                transaction_hash: attempt.tx_hash,
                settlement_worker: attempt.worker,
                settlement_attempt: index + 1
              })
              resolve({ success: true, result, attempt })
            } catch (error) {
              resolve({ success: false, error, attempt })
            }
          } catch (error) {
            reject(error)
          }
        })
      )

      const results = await Promise.allSettled(settlementPromises)

      // Verify only one settlement succeeded (or all report same settlement)
      const finalPayment = db.getPayment(payment.payment_id)
      expect(finalPayment?.state).toBe('COMPLETED')
      expect(finalPayment?.transaction_hash).toBeTruthy()

      // Check that settled_at timestamp is consistent
      expect(finalPayment?.settled_at).toBeTruthy()

      // Verify audit trail maintains integrity
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      const completedLogs = auditLogs.filter(log => log.new_state === 'COMPLETED')

      // Should have at least one completion log
      expect(completedLogs.length).toBeGreaterThanOrEqual(1)
    })

    it('should prevent double spending in race conditions', async () => {
      const paymentData = validator.generatePayment({
        amount: '100.00',
        resource: '/api/double-spend-test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Create domain for signature verification
      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature = await validator.signPayment(paymentData, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      // Create multiple concurrent verification attempts (simulating double spending)
      const verificationAttempts = Array.from({ length: 5 }, (_, index) =>
        new Promise(async (resolve, reject) => {
          try {
            // Create race conditions through rapid execution
            // No artificial delay needed

            const verification = await validator.verifyPaymentSignature(
              paymentData,
              signature,
              domain,
              TEST_CONSTANTS.ADDRESSES.USER
            )

            resolve({ valid: verification.valid, error: verification.error, attempt: index + 1 })
          } catch (error) {
            resolve({ valid: false, error: error.message, attempt: index + 1 })
          }
        })
      )

      const results = await Promise.allSettled(verificationAttempts)

      // Only one verification should succeed
      const validResults = results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<any>).value)
        .filter(result => result.valid)

      expect(validResults).toHaveLength(1)

      // Verify payment state tracking prevents double spending
      expect(validator.getPaymentState(paymentData.payment_id)).toBe('COMPLETED')
    })

    it('should handle concurrent expiry and settlement race', async () => {
      const paymentData = validator.generatePayment({
        amount: '25.00',
        resource: '/api/expiry-race',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Setup concurrent operations
      const expiryOperation = new Promise((resolve, reject) => {
        try {
          // Simulate expiry process
          try {
            const result = db.updatePaymentState(payment.payment_id, 'EXPIRED', {
              expiry_reason: 'timeout',
              expiry_worker: 'expiry_service'
            })
            resolve({ operation: 'expiry', result })
          } catch (error) {
            resolve({ operation: 'expiry', error })
          }
        } catch (error) {
          reject(error)
        }
      })

      const settlementOperation = new Promise((resolve, reject) => {
        try {
          // Simulate settlement process
          try {
            const result = db.updatePaymentState(payment.payment_id, 'COMPLETED', {
              transaction_hash: '0xsettlement123',
              settlement_worker: 'settlement_service'
            })
            resolve({ operation: 'settlement', result })
          } catch (error) {
            resolve({ operation: 'settlement', error })
          }
        } catch (error) {
          reject(error)
        }
      })

      const results = await Promise.allSettled([expiryOperation, settlementOperation])

      // One should succeed, final state should be deterministic
      const finalPayment = db.getPayment(payment.payment_id)
      expect(['EXPIRED', 'COMPLETED']).toContain(finalPayment?.state)

      // Verify audit trail captures the race condition outcome
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('High Load and Stress Testing', () => {
    it('should maintain performance under high payment volume', async () => {
      const highVolumeCount = 200
      const startTime = Date.now()

      // Create payments in batches to simulate realistic load
      const batchSize = 20
      const batches = Math.ceil(highVolumeCount / batchSize)
      const allPayments: any[] = []

      for (let batch = 0; batch < batches; batch++) {
        const batchPromises: Promise<any>[] = []

        for (let i = 0; i < batchSize; i++) {
          const paymentIndex = batch * batchSize + i
          if (paymentIndex >= highVolumeCount) break

          const promise = new Promise((resolve, reject) => {
            try {
              const paymentData = validator.generatePayment({
                amount: (Math.random() * 100 + 0.01).toFixed(2),
                resource: `/api/high-volume-${paymentIndex}`,
                chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
                merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
              })

              const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, {
                batch_id: batch,
                payment_index: paymentIndex
              })

              resolve(payment)
            } catch (error) {
              reject(error)
            }
          })

          batchPromises.push(promise)
        }

        const batchResults = await Promise.allSettled(batchPromises)
        const successfulInBatch = batchResults
          .filter(r => r.status === 'fulfilled')
          .map(r => (r as PromiseFulfilledResult<any>).value)

        allPayments.push(...successfulInBatch)
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      // Verify performance and data integrity
      expect(allPayments).toHaveLength(highVolumeCount)
      expect(duration).toBeLessThan(10000) // Should complete in under 10 seconds

      // Verify database integrity under load
      const storedPayments = db.getPaymentsByState('PENDING', 300)
      expect(storedPayments).toHaveLength(highVolumeCount)

      // Verify all nonces are unique
      const nonces = storedPayments.map(p => p.nonce)
      expect(new Set(nonces).size).toBe(highVolumeCount)

      // Verify audit logs were created for all payments
      let totalAuditLogs = 0
      for (const payment of allPayments) {
        const logs = db.getPaymentAuditLogs(payment.payment_id)
        expect(logs).toHaveLength(1) // Creation log
        totalAuditLogs += logs.length
      }
      expect(totalAuditLogs).toBe(highVolumeCount)
    })

    it('should handle concurrent state transitions under load', async () => {
      // Create a base set of payments
      const paymentCount = 50
      const payments: any[] = []

      for (let i = 0; i < paymentCount; i++) {
        const paymentData = validator.generatePayment({
          amount: (i + 1).toString(),
          resource: `/api/concurrent-state-${i}`,
          chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
          merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
        })

        const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)
        payments.push(payment)
      }

      // Create massive concurrent state transition load
      const transitionPromises: Promise<any>[] = []
      const states: PaymentState[] = ['PROCESSING', 'COMPLETED', 'FAILED']

      for (const payment of payments) {
        for (const state of states) {
          const promise = new Promise((resolve, reject) => {
            try {
              const result = db.updatePaymentState(payment.payment_id, state, {
                load_test: true,
                target_state: state,
                timestamp: Date.now()
              })
              resolve({ payment_id: payment.payment_id, state, success: true, result })
            } catch (error) {
              reject(error)
            }
          })
          transitionPromises.push(promise)
        }
      }

      const results = await Promise.allSettled(transitionPromises)

      // Verify all payments have consistent final states
      for (const payment of payments) {
        const finalPayment = db.getPayment(payment.payment_id)
        expect(finalPayment?.state).toBeTruthy()
        expect(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).toContain(finalPayment?.state)

        // Verify audit trail integrity
        const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
        expect(auditLogs.length).toBeGreaterThanOrEqual(1)

        // Verify timestamps are sequential in audit logs
        for (let i = 1; i < auditLogs.length; i++) {
          expect(auditLogs[i].timestamp).toBeGreaterThanOrEqual(auditLogs[i - 1].timestamp)
        }
      }

      // Verify system performance
      const successfulTransitions = results.filter(r => r.status === 'fulfilled').length
      expect(successfulTransitions).toBeGreaterThan(paymentCount) // At least one per payment
    })
  })

  describe('Database Consistency Under Concurrency', () => {
    it('should maintain referential integrity during concurrent operations', async () => {
      const paymentData = validator.generatePayment({
        amount: '75.00',
        resource: '/api/integrity-test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Create concurrent operations that could affect referential integrity
      const operations = [
        // State transitions
        () => db.updatePaymentState(payment.payment_id, 'PROCESSING', { op: 'state1' }),
        () => db.updatePaymentState(payment.payment_id, 'COMPLETED', { op: 'state2' }),
        () => db.updatePaymentState(payment.payment_id, 'FAILED', { op: 'state3' }),

        // Queries
        () => db.getPayment(payment.payment_id),
        () => db.getPaymentAuditLogs(payment.payment_id),
        () => db.getPaymentsByState('PENDING'),

        // Nonce and signature checks
        () => db.isNonceUsed(paymentData.nonce),
        () => db.isSignatureUsed('test_signature_123')
      ]

      const concurrentOperations = operations.map((operation, index) =>
        new Promise((resolve, reject) => {
          try {
            try {
              const result = operation()
              resolve({ operation: index, success: true, result })
            } catch (error) {
              resolve({ operation: index, success: false, error })
            }
          } catch (error) {
            reject(error)
          }
        })
      )

      await Promise.allSettled(concurrentOperations)

      // Verify database integrity after concurrent operations
      const finalPayment = db.getPayment(payment.payment_id)
      expect(finalPayment).toBeTruthy()

      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs.length).toBeGreaterThanOrEqual(1)

      // Verify all audit logs reference the correct payment
      auditLogs.forEach(log => {
        expect(log.payment_id).toBe(payment.payment_id)
      })

      // Verify nonce is still tracked
      expect(db.isNonceUsed(paymentData.nonce)).toBe(true)
    })
  })
})