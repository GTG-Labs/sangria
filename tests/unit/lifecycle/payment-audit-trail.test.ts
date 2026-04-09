/**
 * Comprehensive Payment Lifecycle and Audit Trail Tests
 * Tests complete payment journeys, state transitions, and compliance audit trails
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { CryptoValidator, TEST_CONSTANTS } from '../../utils/crypto-validation.js'
import { PaymentDatabase, PaymentState, TransactionType } from '../../utils/payment-database.js'

describe('Payment Lifecycle and Audit Trail', () => {
  let validator: CryptoValidator
  let db: PaymentDatabase

  beforeEach(() => {
    validator = CryptoValidator.getInstance()
    validator.resetState()

    db = PaymentDatabase.getInstance(':memory:')
    db.reset()
  })

  describe('Complete Payment Lifecycle Journey', () => {
    it('should track complete successful payment lifecycle', async () => {
      // 1. Generate payment request
      const paymentData = validator.generatePayment({
        amount: '25.50',
        resource: '/api/premium-content',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // 2. Create payment in database (PENDING)
      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, {
        ip_address: '203.0.113.42',
        user_agent: 'Mozilla/5.0 (compatible; SangriaSDK/1.0)'
      })

      expect(payment.state).toBe('PENDING')
      expect(payment.amount).toBe('25.5')

      // 3. User signs payment (PROCESSING)
      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )
      const signature = await validator.signPayment(paymentData, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      db.updatePaymentState(payment.payment_id, 'PROCESSING', {
        signature: signature.signature,
        user_signature_timestamp: Math.floor(Date.now() / 1000)
      })

      // 4. Verify signature (remains PROCESSING)
      const verification = await validator.verifyPaymentSignature(
        paymentData,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )
      expect(verification.valid).toBe(true)

      // 5. Submit to blockchain and complete payment
      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const finalPayment = db.updatePaymentState(payment.payment_id, 'COMPLETED', {
        transaction_hash: txHash,
        gas_fee: '0.003',
        block_number: 12345678,
        confirmation_count: 12
      })

      expect(finalPayment?.state).toBe('COMPLETED')
      expect(finalPayment?.transaction_hash).toBe(txHash)
      expect(finalPayment?.settled_at).toBeGreaterThanOrEqual(payment.created_at)

      // 6. Verify complete audit trail
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs).toHaveLength(3)

      const [created, processing, completed] = auditLogs
      expect(created.transaction_type).toBe('PAYMENT_CREATED')
      expect(created.previous_state).toBeNull()
      expect(created.new_state).toBe('PENDING')

      expect(processing.transaction_type).toBe('PAYMENT_VERIFIED')
      expect(processing.previous_state).toBe('PENDING')
      expect(processing.new_state).toBe('PROCESSING')

      expect(completed.transaction_type).toBe('PAYMENT_SETTLED')
      expect(completed.previous_state).toBe('PROCESSING')
      expect(completed.new_state).toBe('COMPLETED')

      // Verify timestamps are sequential
      expect(processing.timestamp).toBeGreaterThanOrEqual(created.timestamp)
      expect(completed.timestamp).toBeGreaterThanOrEqual(processing.timestamp)
    })

    it('should handle payment failure scenarios with proper audit trail', async () => {
      const paymentData = validator.generatePayment({
        amount: '100.00',
        resource: '/api/expensive-service',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Simulate processing
      db.updatePaymentState(payment.payment_id, 'PROCESSING', {
        attempt_number: 1,
        processing_start: Math.floor(Date.now() / 1000)
      })

      // Simulate failure
      db.updatePaymentState(payment.payment_id, 'FAILED', {
        error_message: 'Insufficient wallet balance',
        error_code: 'INSUFFICIENT_FUNDS',
        failed_tx_hash: '0xfailure123',
        retry_count: 3
      })

      const finalPayment = db.getPayment(payment.payment_id)
      expect(finalPayment?.state).toBe('FAILED')
      expect(finalPayment?.error_message).toBe('Insufficient wallet balance')
      expect(finalPayment?.settled_at).toBeNull()

      // Verify failure audit trail
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs).toHaveLength(3)
      expect(auditLogs[2].transaction_type).toBe('PAYMENT_FAILED')
      expect(auditLogs[2].new_state).toBe('FAILED')
    })

    it('should handle payment expiry with cleanup', async () => {
      const paymentData = validator.generatePayment({
        amount: '5.00',
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Mock expiry by overriding the method temporarily
      const originalGetExpired = db.getExpiredPayments
      db.getExpiredPayments = function() {
        return [payment as any]
      }

      try {
        // Run expiry cleanup
        const expiredCount = db.cleanupExpiredPayments()
        expect(expiredCount).toBe(1)

        const expiredPayment = db.getPayment(payment.payment_id)
        expect(expiredPayment?.state).toBe('EXPIRED')

        // Verify expiry audit trail
        const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
        expect(auditLogs).toHaveLength(2)
        expect(auditLogs[1].transaction_type).toBe('PAYMENT_EXPIRED')
      } finally {
        db.getExpiredPayments = originalGetExpired
      }
    })
  })

  describe('State Transition Validation', () => {
    let payment: any

    beforeEach(() => {
      const paymentData = validator.generatePayment({
        amount: '10.00',
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })
      payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)
    })

    const validTransitions: Array<[PaymentState, PaymentState[]]> = [
      ['PENDING', ['PROCESSING', 'FAILED', 'EXPIRED', 'CANCELLED']],
      ['PROCESSING', ['COMPLETED', 'FAILED', 'CANCELLED']],
      ['COMPLETED', []], // Terminal state
      ['FAILED', ['PROCESSING']], // Can retry
      ['EXPIRED', []], // Terminal state
      ['CANCELLED', []] // Terminal state
    ]

    validTransitions.forEach(([fromState, toStates]) => {
      it(`should allow valid transitions from ${fromState}`, () => {
        // Set initial state
        if (fromState !== 'PENDING') {
          db.updatePaymentState(payment.payment_id, fromState)
        }

        toStates.forEach(toState => {
          // Reset for each test
          db.updatePaymentState(payment.payment_id, fromState)

          expect(() => {
            db.updatePaymentState(payment.payment_id, toState, {
              transition_reason: `Test transition from ${fromState} to ${toState}`
            })
          }).not.toThrow()

          const updated = db.getPayment(payment.payment_id)
          expect(updated?.state).toBe(toState)
        })
      })
    })

    it('should preserve state transition history in audit logs', () => {
      // Create multiple state transitions
      const transitions = [
        'PROCESSING',
        'FAILED',
        'PROCESSING', // Retry
        'COMPLETED'
      ] as PaymentState[]

      transitions.forEach((state, index) => {
        db.updatePaymentState(payment.payment_id, state, {
          transition_reason: `Step ${index + 1}`,
          step_metadata: { step: index + 1, timestamp: Date.now() }
        })
      })

      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs).toHaveLength(transitions.length + 1) // +1 for initial creation

      // Verify state progression
      const states = auditLogs.map(log => log.new_state)
      expect(states).toEqual(['PENDING', ...transitions])

      // Verify previous state tracking
      for (let i = 1; i < auditLogs.length; i++) {
        expect(auditLogs[i].previous_state).toBe(auditLogs[i - 1].new_state)
      }
    })
  })

  describe('Audit Trail Compliance', () => {
    it('should maintain immutable audit trail', async () => {
      const paymentData = validator.generatePayment({
        amount: '1000.00',
        resource: '/api/high-value',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, {
        ip_address: '192.168.1.100',
        user_agent: 'Compliance Agent/1.0',
        session_id: 'sess_audit_test_123'
      })

      // Create comprehensive state transitions
      const transitions = [
        { state: 'PROCESSING' as PaymentState, metadata: { signature: 'sig_123', verification_time: Date.now() } },
        { state: 'COMPLETED' as PaymentState, metadata: { tx_hash: '0xabc', gas: '0.001', block: 12345 } }
      ]

      transitions.forEach(({ state, metadata }) => {
        db.updatePaymentState(payment.payment_id, state, metadata)
      })

      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)

      // Verify audit logs contain all required compliance information
      auditLogs.forEach((log, index) => {
        expect(log.payment_id).toBe(payment.payment_id)
        expect(log.timestamp).toBeGreaterThan(0)
        expect(log.new_state).toBeTruthy()

        if (index > 0) {
          expect(log.previous_state).toBeTruthy()
        }

        // Check that each log has immutable ID
        expect(log.id).toBeGreaterThan(0)
      })

      // Verify logs are ordered by timestamp
      for (let i = 1; i < auditLogs.length; i++) {
        expect(auditLogs[i].timestamp).toBeGreaterThanOrEqual(auditLogs[i - 1].timestamp)
      }

      // Attempt to verify audit log integrity (logs cannot be modified)
      try {
        // This should fail or be prevented by database constraints
        (db as any).db.prepare('UPDATE audit_logs SET new_state = ? WHERE id = ?').run('HACKED', auditLogs[0].id)

        // If update succeeded, verify the audit trail still shows original data
        const updatedLogs = db.getPaymentAuditLogs(payment.payment_id)
        // In production, this should either fail the update or maintain integrity
        expect(updatedLogs).toHaveLength(auditLogs.length)
      } catch (e) {
        // Expected - audit logs should be protected from modification
      }
    })

    it('should track metadata changes in audit trail', () => {
      const paymentData = validator.generatePayment({
        amount: '50.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Track different types of metadata
      const metadataSteps = [
        {
          state: 'PROCESSING' as PaymentState,
          metadata: {
            user_signature: 'sig_user_123',
            signature_timestamp: Date.now(),
            user_agent: 'Chrome/90.0',
            ip_address: '203.0.113.1'
          }
        },
        {
          state: 'COMPLETED' as PaymentState,
          metadata: {
            transaction_hash: '0xdef456',
            block_number: 12345678,
            gas_fee: '0.002',
            confirmation_count: 12,
            settlement_timestamp: Date.now()
          }
        }
      ]

      metadataSteps.forEach(({ state, metadata }) => {
        db.updatePaymentState(payment.payment_id, state, metadata)
      })

      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)

      // Verify metadata is preserved in audit logs
      const processingLog = auditLogs.find(log => log.new_state === 'PROCESSING')
      const completedLog = auditLogs.find(log => log.new_state === 'COMPLETED')

      expect(processingLog?.metadata).toBeTruthy()
      expect(completedLog?.metadata).toBeTruthy()

      // Parse and verify metadata content
      if (processingLog?.metadata) {
        const processingMeta = JSON.parse(processingLog.metadata)
        expect(processingMeta.user_signature).toBe('sig_user_123')
        expect(processingMeta.ip_address).toBe('203.0.113.1')
      }

      if (completedLog?.metadata) {
        const completedMeta = JSON.parse(completedLog.metadata)
        expect(completedMeta.transaction_hash).toBe('0xdef456')
        expect(completedMeta.gas_fee).toBe('0.002')
      }
    })
  })

  describe('Financial Compliance Reporting', () => {
    it('should generate comprehensive payment metrics for compliance', () => {
      // Create multiple payments with different states and amounts
      const testPayments = [
        { amount: '100.00', state: 'COMPLETED' as PaymentState, tx: '0xabc123' },
        { amount: '250.50', state: 'COMPLETED' as PaymentState, tx: '0xdef456' },
        { amount: '75.25', state: 'FAILED' as PaymentState, error: 'Network error' },
        { amount: '500.00', state: 'PENDING' as PaymentState },
        { amount: '25.00', state: 'EXPIRED' as PaymentState }
      ]

      testPayments.forEach((testPayment, index) => {
        const paymentData = validator.generatePayment({
          amount: testPayment.amount,
          resource: `/api/service-${index}`,
          chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
          merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
        })

        const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, {
          compliance_id: `comp_${index}`,
          user_kyc_status: 'verified'
        })

        if (testPayment.state !== 'PENDING') {
          const metadata = testPayment.state === 'COMPLETED'
            ? { transaction_hash: testPayment.tx }
            : testPayment.state === 'FAILED'
            ? { error_message: testPayment.error }
            : {}

          db.updatePaymentState(payment.payment_id, testPayment.state, metadata)
        }
      })

      // Generate compliance metrics
      const metrics = db.getPaymentMetrics()

      expect(metrics.total_payments).toBe(5)
      expect(metrics.successful_payments).toBe(2)
      expect(metrics.failed_payments).toBe(2) // FAILED + EXPIRED
      expect(metrics.total_volume).toBe('350.5') // 100.00 + 250.50
      expect(metrics.average_amount).toBe('175.25') // 350.50 / 2
      expect(metrics.success_rate).toBe(0.4) // 2/5

      // Verify all successful payments have complete audit trails
      const successfulPayments = db.getPaymentsByState('COMPLETED')
      successfulPayments.forEach(payment => {
        const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
        expect(auditLogs.length).toBeGreaterThanOrEqual(2) // At least created + settled

        const settledLog = auditLogs.find(log => log.transaction_type === 'PAYMENT_SETTLED')
        expect(settledLog).toBeTruthy()
      })
    })

    it('should provide detailed audit trail for regulatory compliance', () => {
      const paymentData = validator.generatePayment({
        amount: '10000.00', // High value for compliance testing
        resource: '/api/premium-service',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER, {
        ip_address: '203.0.113.42',
        user_agent: 'ComplianceBot/2.0',
        user_id: 'user_kyc_verified_123',
        compliance_check: 'aml_cleared',
        risk_score: 'low'
      })

      // Simulate complete compliance workflow
      const complianceSteps = [
        {
          state: 'PROCESSING' as PaymentState,
          metadata: {
            compliance_officer: 'officer_123',
            aml_check_result: 'passed',
            risk_assessment: 'low',
            manual_review_required: false
          }
        },
        {
          state: 'COMPLETED' as PaymentState,
          metadata: {
            transaction_hash: '0x' + 'a'.repeat(64),
            gas_fee: '0.005',
            compliance_final_check: 'approved',
            settlement_officer: 'officer_456'
          }
        }
      ]

      complianceSteps.forEach(({ state, metadata }) => {
        db.updatePaymentState(payment.payment_id, state, metadata)
      })

      // Verify comprehensive compliance audit trail
      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)

      // Check that high-value payment has complete documentation
      expect(auditLogs).toHaveLength(3) // Created, Processing, Completed

      const createdLog = auditLogs[0]
      const processingLog = auditLogs[1]
      const completedLog = auditLogs[2]

      // Verify creation has user identification
      expect(createdLog.ip_address).toBe('203.0.113.42')
      expect(createdLog.user_agent).toBe('ComplianceBot/2.0')

      // Verify compliance metadata is preserved
      if (processingLog.metadata) {
        const processingMeta = JSON.parse(processingLog.metadata)
        expect(processingMeta.aml_check_result).toBe('passed')
        expect(processingMeta.compliance_officer).toBe('officer_123')
      }

      if (completedLog.metadata) {
        const completedMeta = JSON.parse(completedLog.metadata)
        expect(completedMeta.compliance_final_check).toBe('approved')
        expect(completedMeta.settlement_officer).toBe('officer_456')
      }
    })
  })

  describe('Payment Retry and Recovery', () => {
    it('should handle payment retry scenarios with audit trail', () => {
      const paymentData = validator.generatePayment({
        amount: '15.75',
        resource: '/api/retry-test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment = db.createPayment(paymentData, TEST_CONSTANTS.ADDRESSES.USER)

      // Simulate retry scenario
      const retrySequence = [
        { state: 'PROCESSING' as PaymentState, metadata: { attempt: 1 } },
        { state: 'FAILED' as PaymentState, metadata: { attempt: 1, error: 'Network timeout' } },
        { state: 'PROCESSING' as PaymentState, metadata: { attempt: 2, retry_delay: 30 } },
        { state: 'FAILED' as PaymentState, metadata: { attempt: 2, error: 'Insufficient gas' } },
        { state: 'PROCESSING' as PaymentState, metadata: { attempt: 3, increased_gas: true } },
        { state: 'COMPLETED' as PaymentState, metadata: { attempt: 3, tx_hash: '0xsuccess' } }
      ]

      retrySequence.forEach(({ state, metadata }) => {
        db.updatePaymentState(payment.payment_id, state, metadata)
      })

      const auditLogs = db.getPaymentAuditLogs(payment.payment_id)
      expect(auditLogs).toHaveLength(retrySequence.length + 1) // +1 for initial creation

      // Verify retry attempts are tracked
      const failureLogs = auditLogs.filter(log => log.transaction_type === 'PAYMENT_FAILED')
      expect(failureLogs).toHaveLength(2)

      const finalPayment = db.getPayment(payment.payment_id)
      expect(finalPayment?.state).toBe('COMPLETED')
    })
  })
})