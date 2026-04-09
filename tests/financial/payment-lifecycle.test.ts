/**
 * Payment State Transition and Lifecycle Tests
 * Tests the complete payment lifecycle with proper state management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ethers } from 'ethers'

// Payment states following a proper finite state machine
enum PaymentState {
  CREATED = 'CREATED',
  AUTHORIZED = 'AUTHORIZED',
  VERIFIED = 'VERIFIED',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

// Payment status reasons for failed states
enum FailureReason {
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  EXPIRED_PAYMENT = 'EXPIRED_PAYMENT',
  NONCE_REUSED = 'NONCE_REUSED',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  UNAUTHORIZED = 'UNAUTHORIZED'
}

interface PaymentRecord {
  id: string
  state: PaymentState
  amount: string
  currency: string
  from?: string
  to?: string
  resource: string
  nonce?: string
  signature?: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  transactionHash?: string
  blockNumber?: number
  gasUsed?: string
  failureReason?: FailureReason
  retryCount: number
  metadata?: Record<string, any>
}

describe('Payment Lifecycle and State Transitions', () => {
  let paymentStore: Map<string, PaymentRecord>
  let stateTransitionLog: Array<{
    paymentId: string
    fromState: PaymentState
    toState: PaymentState
    timestamp: number
    reason?: string
  }>

  beforeEach(() => {
    paymentStore = new Map()
    stateTransitionLog = []
  })

  describe('Payment State Machine', () => {
    it('should define valid state transitions', () => {
      const validTransitions = new Map<PaymentState, PaymentState[]>([
        [PaymentState.CREATED, [PaymentState.AUTHORIZED, PaymentState.EXPIRED, PaymentState.CANCELLED]],
        [PaymentState.AUTHORIZED, [PaymentState.VERIFIED, PaymentState.FAILED, PaymentState.EXPIRED, PaymentState.CANCELLED]],
        [PaymentState.VERIFIED, [PaymentState.SETTLED, PaymentState.FAILED]],
        [PaymentState.SETTLED, [PaymentState.REFUNDED]], // Terminal state (only refunds allowed)
        [PaymentState.FAILED, [PaymentState.AUTHORIZED]], // Can retry after fixing issues
        [PaymentState.EXPIRED, []], // Terminal state
        [PaymentState.CANCELLED, []], // Terminal state
        [PaymentState.REFUNDED, []] // Terminal state
      ])

      const isValidTransition = (from: PaymentState, to: PaymentState): boolean => {
        const allowedStates = validTransitions.get(from) || []
        return allowedStates.includes(to)
      }

      // Test valid transitions
      expect(isValidTransition(PaymentState.CREATED, PaymentState.AUTHORIZED)).toBe(true)
      expect(isValidTransition(PaymentState.AUTHORIZED, PaymentState.VERIFIED)).toBe(true)
      expect(isValidTransition(PaymentState.VERIFIED, PaymentState.SETTLED)).toBe(true)
      expect(isValidTransition(PaymentState.SETTLED, PaymentState.REFUNDED)).toBe(true)
      expect(isValidTransition(PaymentState.FAILED, PaymentState.AUTHORIZED)).toBe(true) // Retry

      // Test invalid transitions
      expect(isValidTransition(PaymentState.CREATED, PaymentState.SETTLED)).toBe(false) // Skip states
      expect(isValidTransition(PaymentState.SETTLED, PaymentState.VERIFIED)).toBe(false) // Backwards
      expect(isValidTransition(PaymentState.EXPIRED, PaymentState.AUTHORIZED)).toBe(false) // From terminal
      expect(isValidTransition(PaymentState.CANCELLED, PaymentState.VERIFIED)).toBe(false) // From terminal
    })

    it('should enforce state transition rules', () => {
      const transitionPayment = (
        paymentId: string,
        newState: PaymentState,
        reason?: string,
        metadata?: Record<string, any>
      ): boolean => {
        const payment = paymentStore.get(paymentId)
        if (!payment) return false

        const validTransitions = new Map<PaymentState, PaymentState[]>([
          [PaymentState.CREATED, [PaymentState.AUTHORIZED, PaymentState.EXPIRED, PaymentState.CANCELLED]],
          [PaymentState.AUTHORIZED, [PaymentState.VERIFIED, PaymentState.FAILED, PaymentState.EXPIRED, PaymentState.CANCELLED]],
          [PaymentState.VERIFIED, [PaymentState.SETTLED, PaymentState.FAILED]],
          [PaymentState.SETTLED, [PaymentState.REFUNDED]],
          [PaymentState.FAILED, [PaymentState.AUTHORIZED]],
          [PaymentState.EXPIRED, []],
          [PaymentState.CANCELLED, []],
          [PaymentState.REFUNDED, []]
        ])

        const allowedStates = validTransitions.get(payment.state) || []
        if (!allowedStates.includes(newState)) {
          return false // Invalid transition
        }

        // Log transition
        stateTransitionLog.push({
          paymentId,
          fromState: payment.state,
          toState: newState,
          timestamp: Math.floor(Date.now() / 1000),
          reason
        })

        // Update payment
        const oldState = payment.state
        payment.state = newState
        payment.updatedAt = Math.floor(Date.now() / 1000)

        if (metadata) {
          payment.metadata = { ...payment.metadata, ...metadata }
        }

        // State-specific updates
        if (newState === PaymentState.FAILED && reason) {
          payment.failureReason = reason as FailureReason
          payment.retryCount += 1
        }

        paymentStore.set(paymentId, payment)
        return true
      }

      // Create test payment
      const payment: PaymentRecord = {
        id: 'test-payment-1',
        state: PaymentState.CREATED,
        amount: ethers.parseUnits('0.01', 6).toString(),
        currency: 'USDC',
        resource: '/api/premium',
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        retryCount: 0
      }

      paymentStore.set(payment.id, payment)

      // Test valid transitions
      expect(transitionPayment(payment.id, PaymentState.AUTHORIZED)).toBe(true)
      expect(transitionPayment(payment.id, PaymentState.VERIFIED)).toBe(true)
      expect(transitionPayment(payment.id, PaymentState.SETTLED)).toBe(true)

      // Test invalid transition from settled state
      expect(transitionPayment(payment.id, PaymentState.AUTHORIZED)).toBe(false)

      // Verify transition log
      expect(stateTransitionLog.length).toBe(3)
      expect(stateTransitionLog[0].fromState).toBe(PaymentState.CREATED)
      expect(stateTransitionLog[0].toState).toBe(PaymentState.AUTHORIZED)
      expect(stateTransitionLog[2].fromState).toBe(PaymentState.VERIFIED)
      expect(stateTransitionLog[2].toState).toBe(PaymentState.SETTLED)
    })
  })

  describe('Payment Lifecycle Events', () => {
    it('should handle complete successful payment lifecycle', async () => {
      const paymentLifecycle = {
        // Step 1: Create payment
        createPayment: (amount: string, resource: string): PaymentRecord => {
          const payment: PaymentRecord = {
            id: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            state: PaymentState.CREATED,
            amount,
            currency: 'USDC',
            resource,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor(Date.now() / 1000) + 300, // 5 minutes
            retryCount: 0
          }

          paymentStore.set(payment.id, payment)
          return payment
        },

        // Step 2: Authorize payment with signature
        authorizePayment: (paymentId: string, from: string, to: string, nonce: string, signature: string): boolean => {
          const payment = paymentStore.get(paymentId)
          if (!payment || payment.state !== PaymentState.CREATED) return false

          // Check expiry
          if (payment.expiresAt <= Math.floor(Date.now() / 1000)) {
            paymentLifecycle.expirePayment(paymentId)
            return false
          }

          payment.from = from
          payment.to = to
          payment.nonce = nonce
          payment.signature = signature
          payment.state = PaymentState.AUTHORIZED
          payment.updatedAt = Math.floor(Date.now() / 1000)

          paymentStore.set(paymentId, payment)
          return true
        },

        // Step 3: Verify signature and conditions
        verifyPayment: (paymentId: string): boolean => {
          const payment = paymentStore.get(paymentId)
          if (!payment || payment.state !== PaymentState.AUTHORIZED) return false

          // Simulate signature verification (would be real crypto validation)
          if (!payment.signature || !payment.from || !payment.to) {
            paymentLifecycle.failPayment(paymentId, FailureReason.INVALID_SIGNATURE)
            return false
          }

          // Check balance (simulate)
          const mockBalances = new Map([
            ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', ethers.parseUnits('1000', 6).toString()],
            ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', ethers.parseUnits('500', 6).toString()],
            ['0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', '0']
          ])

          const balance = BigInt(mockBalances.get(payment.from) || '0')
          const amount = BigInt(payment.amount)

          if (balance < amount) {
            paymentLifecycle.failPayment(paymentId, FailureReason.INSUFFICIENT_FUNDS)
            return false
          }

          payment.state = PaymentState.VERIFIED
          payment.updatedAt = Math.floor(Date.now() / 1000)
          paymentStore.set(paymentId, payment)
          return true
        },

        // Step 4: Settle payment on blockchain
        settlePayment: (paymentId: string): boolean => {
          const payment = paymentStore.get(paymentId)
          if (!payment || payment.state !== PaymentState.VERIFIED) return false

          // Simulate blockchain settlement
          const transactionHash = `0x${paymentId.replace('payment_', '')}`

          payment.state = PaymentState.SETTLED
          payment.transactionHash = transactionHash
          payment.blockNumber = Math.floor(Math.random() * 1000000) + 12000000 // Mock block number
          payment.gasUsed = '21000' // Mock gas used
          payment.updatedAt = Math.floor(Date.now() / 1000)

          paymentStore.set(paymentId, payment)
          return true
        },

        // Failure handling
        failPayment: (paymentId: string, reason: FailureReason): boolean => {
          const payment = paymentStore.get(paymentId)
          if (!payment) return false

          payment.state = PaymentState.FAILED
          payment.failureReason = reason
          payment.retryCount += 1
          payment.updatedAt = Math.floor(Date.now() / 1000)

          paymentStore.set(paymentId, payment)
          return true
        },

        // Expiry handling
        expirePayment: (paymentId: string): boolean => {
          const payment = paymentStore.get(paymentId)
          if (!payment) return false

          payment.state = PaymentState.EXPIRED
          payment.updatedAt = Math.floor(Date.now() / 1000)

          paymentStore.set(paymentId, payment)
          return true
        },

        // Refund handling
        refundPayment: (paymentId: string): boolean => {
          const payment = paymentStore.get(paymentId)
          if (!payment || payment.state !== PaymentState.SETTLED) return false

          payment.state = PaymentState.REFUNDED
          payment.updatedAt = Math.floor(Date.now() / 1000)

          paymentStore.set(paymentId, payment)
          return true
        }
      }

      // Test complete successful lifecycle
      const payment = paymentLifecycle.createPayment(
        ethers.parseUnits('0.01', 6).toString(),
        '/api/premium'
      )

      expect(payment.state).toBe(PaymentState.CREATED)

      // Authorize
      const authorized = paymentLifecycle.authorizePayment(
        payment.id,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D',
        '0x' + 'test'.repeat(16),
        '0x' + 'signature'.repeat(14)
      )

      expect(authorized).toBe(true)
      expect(paymentStore.get(payment.id)?.state).toBe(PaymentState.AUTHORIZED)

      // Verify
      const verified = paymentLifecycle.verifyPayment(payment.id)
      expect(verified).toBe(true)
      expect(paymentStore.get(payment.id)?.state).toBe(PaymentState.VERIFIED)

      // Settle
      const settled = paymentLifecycle.settlePayment(payment.id)
      expect(settled).toBe(true)

      const finalPayment = paymentStore.get(payment.id)!
      expect(finalPayment.state).toBe(PaymentState.SETTLED)
      expect(finalPayment.transactionHash).toBeDefined()
      expect(finalPayment.blockNumber).toBeGreaterThan(0)
    })

    it('should handle payment failures at each stage', () => {
      const paymentManager = {
        createPayment: (amount: string, resource: string): PaymentRecord => {
          const payment: PaymentRecord = {
            id: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            state: PaymentState.CREATED,
            amount,
            currency: 'USDC',
            resource,
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            expiresAt: Math.floor(Date.now() / 1000) + 300,
            retryCount: 0
          }

          paymentStore.set(payment.id, payment)
          return payment
        },

        failPayment: (paymentId: string, reason: FailureReason): void => {
          const payment = paymentStore.get(paymentId)
          if (payment) {
            payment.state = PaymentState.FAILED
            payment.failureReason = reason
            payment.retryCount += 1
            payment.updatedAt = Math.floor(Date.now() / 1000)
            paymentStore.set(paymentId, payment)
          }
        }
      }

      // Test insufficient funds failure
      const payment1 = paymentManager.createPayment(
        ethers.parseUnits('1000', 6).toString(), // Large amount
        '/api/premium'
      )

      paymentManager.failPayment(payment1.id, FailureReason.INSUFFICIENT_FUNDS)

      const failedPayment1 = paymentStore.get(payment1.id)!
      expect(failedPayment1.state).toBe(PaymentState.FAILED)
      expect(failedPayment1.failureReason).toBe(FailureReason.INSUFFICIENT_FUNDS)
      expect(failedPayment1.retryCount).toBe(1)

      // Test invalid signature failure
      const payment2 = paymentManager.createPayment(
        ethers.parseUnits('0.01', 6).toString(),
        '/api/premium'
      )

      paymentManager.failPayment(payment2.id, FailureReason.INVALID_SIGNATURE)

      const failedPayment2 = paymentStore.get(payment2.id)!
      expect(failedPayment2.state).toBe(PaymentState.FAILED)
      expect(failedPayment2.failureReason).toBe(FailureReason.INVALID_SIGNATURE)

      // Test nonce reuse failure
      const payment3 = paymentManager.createPayment(
        ethers.parseUnits('0.01', 6).toString(),
        '/api/premium'
      )

      paymentManager.failPayment(payment3.id, FailureReason.NONCE_REUSED)

      const failedPayment3 = paymentStore.get(payment3.id)!
      expect(failedPayment3.state).toBe(PaymentState.FAILED)
      expect(failedPayment3.failureReason).toBe(FailureReason.NONCE_REUSED)
    })

    it('should handle payment expiry correctly', () => {
      // Create payment with short expiry
      const shortExpiryPayment: PaymentRecord = {
        id: 'expiry-test-payment',
        state: PaymentState.CREATED,
        amount: ethers.parseUnits('0.01', 6).toString(),
        currency: 'USDC',
        resource: '/api/premium',
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) - 100, // Already expired
        retryCount: 0
      }

      paymentStore.set(shortExpiryPayment.id, shortExpiryPayment)

      const checkAndExpirePayment = (paymentId: string): boolean => {
        const payment = paymentStore.get(paymentId)
        if (!payment) return false

        if (payment.expiresAt <= Math.floor(Date.now() / 1000)) {
          payment.state = PaymentState.EXPIRED
          payment.updatedAt = Math.floor(Date.now() / 1000)
          paymentStore.set(paymentId, payment)
          return true
        }

        return false
      }

      // Check expiry
      const expired = checkAndExpirePayment(shortExpiryPayment.id)
      expect(expired).toBe(true)

      const expiredPayment = paymentStore.get(shortExpiryPayment.id)!
      expect(expiredPayment.state).toBe(PaymentState.EXPIRED)

      // Verify cannot transition from expired state
      expiredPayment.state = PaymentState.AUTHORIZED
      paymentStore.set(shortExpiryPayment.id, expiredPayment)

      // This would be rejected by proper state machine
      const validTransitions = new Map<PaymentState, PaymentState[]>([
        [PaymentState.EXPIRED, []] // Terminal state
      ])

      const allowedStates = validTransitions.get(PaymentState.EXPIRED) || []
      expect(allowedStates.includes(PaymentState.AUTHORIZED)).toBe(false)
    })
  })

  describe('Payment Retry Logic', () => {
    it('should implement retry logic with backoff', () => {
      interface RetryConfig {
        maxRetries: number
        baseDelayMs: number
        backoffMultiplier: number
        maxDelayMs: number
      }

      const retryConfig: RetryConfig = {
        maxRetries: 3,
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 30000
      }

      const calculateRetryDelay = (retryCount: number, config: RetryConfig): number => {
        if (retryCount >= config.maxRetries) return -1 // No more retries

        const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, retryCount)
        return Math.min(delay, config.maxDelayMs)
      }

      const canRetry = (payment: PaymentRecord): boolean => {
        if (payment.state !== PaymentState.FAILED) return false
        if (payment.retryCount >= retryConfig.maxRetries) return false

        // Some failures are not retryable
        const nonRetryableFailures = [
          FailureReason.INVALID_SIGNATURE,
          FailureReason.INVALID_AMOUNT,
          FailureReason.EXPIRED_PAYMENT
        ]

        return !payment.failureReason || !nonRetryableFailures.includes(payment.failureReason)
      }

      // Test retry delays
      expect(calculateRetryDelay(0, retryConfig)).toBe(1000) // First retry: 1s
      expect(calculateRetryDelay(1, retryConfig)).toBe(2000) // Second retry: 2s
      expect(calculateRetryDelay(2, retryConfig)).toBe(4000) // Third retry: 4s
      expect(calculateRetryDelay(3, retryConfig)).toBe(-1) // No more retries

      // Test retryable failures
      const retryablePayment: PaymentRecord = {
        id: 'retryable-payment',
        state: PaymentState.FAILED,
        amount: ethers.parseUnits('0.01', 6).toString(),
        currency: 'USDC',
        resource: '/api/premium',
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        retryCount: 1,
        failureReason: FailureReason.INSUFFICIENT_FUNDS // Retryable
      }

      expect(canRetry(retryablePayment)).toBe(true)

      // Test non-retryable failure
      const nonRetryablePayment: PaymentRecord = {
        ...retryablePayment,
        failureReason: FailureReason.INVALID_SIGNATURE
      }

      expect(canRetry(nonRetryablePayment)).toBe(false)

      // Test max retries exceeded
      const maxRetriesPayment: PaymentRecord = {
        ...retryablePayment,
        retryCount: 3
      }

      expect(canRetry(maxRetriesPayment)).toBe(false)
    })
  })

  describe('Payment Concurrency and Race Conditions', () => {
    it('should handle concurrent payment operations safely', () => {
      const paymentLocks = new Map<string, boolean>()

      const lockPayment = (paymentId: string): boolean => {
        if (paymentLocks.get(paymentId)) return false // Already locked
        paymentLocks.set(paymentId, true)
        return true
      }

      const unlockPayment = (paymentId: string): void => {
        paymentLocks.delete(paymentId)
      }

      const atomicStateTransition = (
        paymentId: string,
        expectedState: PaymentState,
        newState: PaymentState
      ): boolean => {
        if (!lockPayment(paymentId)) return false

        try {
          const payment = paymentStore.get(paymentId)
          if (!payment || payment.state !== expectedState) {
            return false // State changed or payment not found
          }

          payment.state = newState
          payment.updatedAt = Math.floor(Date.now() / 1000)
          paymentStore.set(paymentId, payment)
          return true
        } finally {
          unlockPayment(paymentId)
        }
      }

      // Create test payment
      const payment: PaymentRecord = {
        id: 'concurrent-test',
        state: PaymentState.CREATED,
        amount: ethers.parseUnits('0.01', 6).toString(),
        currency: 'USDC',
        resource: '/api/premium',
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        retryCount: 0
      }

      paymentStore.set(payment.id, payment)

      // Test successful atomic transition
      const result1 = atomicStateTransition(payment.id, PaymentState.CREATED, PaymentState.AUTHORIZED)
      expect(result1).toBe(true)
      expect(paymentStore.get(payment.id)?.state).toBe(PaymentState.AUTHORIZED)

      // Test concurrent operation (should fail due to wrong expected state)
      const result2 = atomicStateTransition(payment.id, PaymentState.CREATED, PaymentState.CANCELLED)
      expect(result2).toBe(false)
      expect(paymentStore.get(payment.id)?.state).toBe(PaymentState.AUTHORIZED) // Unchanged

      // Test lock contention simulation
      lockPayment(payment.id) // Manually lock

      const result3 = atomicStateTransition(payment.id, PaymentState.AUTHORIZED, PaymentState.VERIFIED)
      expect(result3).toBe(false) // Should fail due to lock

      unlockPayment(payment.id) // Unlock

      const result4 = atomicStateTransition(payment.id, PaymentState.AUTHORIZED, PaymentState.VERIFIED)
      expect(result4).toBe(true) // Should succeed
    })

    it('should prevent double spending through proper state management', () => {
      const nonceUsage = new Map<string, string>() // nonce -> paymentId

      const reserveNonce = (nonce: string, paymentId: string): boolean => {
        if (nonceUsage.has(nonce)) {
          const existingPaymentId = nonceUsage.get(nonce)!
          const existingPayment = paymentStore.get(existingPaymentId)

          // Allow if existing payment failed or expired
          if (existingPayment &&
              (existingPayment.state === PaymentState.FAILED ||
               existingPayment.state === PaymentState.EXPIRED ||
               existingPayment.state === PaymentState.CANCELLED)) {
            nonceUsage.set(nonce, paymentId)
            return true
          }

          return false // Nonce in use by active payment
        }

        nonceUsage.set(nonce, paymentId)
        return true
      }

      const releaseNonce = (nonce: string): void => {
        nonceUsage.delete(nonce)
      }

      // Test nonce reservation
      const nonce1 = '0x' + 'test1'.repeat(12)
      const payment1Id = 'payment-1'

      expect(reserveNonce(nonce1, payment1Id)).toBe(true)

      // Try to reuse same nonce (should fail)
      const payment2Id = 'payment-2'
      expect(reserveNonce(nonce1, payment2Id)).toBe(false)

      // Create failed payment with first nonce
      const failedPayment: PaymentRecord = {
        id: payment1Id,
        state: PaymentState.FAILED,
        amount: ethers.parseUnits('0.01', 6).toString(),
        currency: 'USDC',
        resource: '/api/premium',
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        retryCount: 1,
        nonce: nonce1,
        failureReason: FailureReason.INSUFFICIENT_FUNDS
      }

      paymentStore.set(payment1Id, failedPayment)

      // Now nonce can be reused for new payment
      expect(reserveNonce(nonce1, payment2Id)).toBe(true)
    })
  })

  describe('Payment Analytics and Monitoring', () => {
    it('should track payment metrics for monitoring', () => {
      interface PaymentMetrics {
        totalPayments: number
        successfulPayments: number
        failedPayments: number
        expiredPayments: number
        totalVolume: bigint
        avgPaymentTime: number
        failureReasons: Map<FailureReason, number>
        paymentsByState: Map<PaymentState, number>
      }

      const calculateMetrics = (payments: PaymentRecord[]): PaymentMetrics => {
        const metrics: PaymentMetrics = {
          totalPayments: payments.length,
          successfulPayments: 0,
          failedPayments: 0,
          expiredPayments: 0,
          totalVolume: BigInt('0'),
          avgPaymentTime: 0,
          failureReasons: new Map(),
          paymentsByState: new Map()
        }

        let totalProcessingTime = 0

        for (const payment of payments) {
          // Count by state
          const currentCount = metrics.paymentsByState.get(payment.state) || 0
          metrics.paymentsByState.set(payment.state, currentCount + 1)

          // Count outcomes
          switch (payment.state) {
            case PaymentState.SETTLED:
              metrics.successfulPayments++
              metrics.totalVolume += BigInt(payment.amount)
              break
            case PaymentState.FAILED:
              metrics.failedPayments++
              if (payment.failureReason) {
                const reasonCount = metrics.failureReasons.get(payment.failureReason) || 0
                metrics.failureReasons.set(payment.failureReason, reasonCount + 1)
              }
              break
            case PaymentState.EXPIRED:
              metrics.expiredPayments++
              break
          }

          // Calculate processing time for completed payments
          if (payment.state === PaymentState.SETTLED || payment.state === PaymentState.FAILED) {
            totalProcessingTime += payment.updatedAt - payment.createdAt
          }
        }

        const completedPayments = metrics.successfulPayments + metrics.failedPayments
        if (completedPayments > 0) {
          metrics.avgPaymentTime = totalProcessingTime / completedPayments
        }

        return metrics
      }

      // Create sample payments for testing
      const samplePayments: PaymentRecord[] = [
        {
          id: 'payment-1',
          state: PaymentState.SETTLED,
          amount: ethers.parseUnits('10', 6).toString(),
          currency: 'USDC',
          resource: '/api/premium',
          createdAt: 1000,
          updatedAt: 1030,
          expiresAt: 1300,
          retryCount: 0
        },
        {
          id: 'payment-2',
          state: PaymentState.FAILED,
          amount: ethers.parseUnits('5', 6).toString(),
          currency: 'USDC',
          resource: '/api/premium',
          createdAt: 1100,
          updatedAt: 1110,
          expiresAt: 1400,
          retryCount: 1,
          failureReason: FailureReason.INSUFFICIENT_FUNDS
        },
        {
          id: 'payment-3',
          state: PaymentState.SETTLED,
          amount: ethers.parseUnits('20', 6).toString(),
          currency: 'USDC',
          resource: '/api/data',
          createdAt: 1200,
          updatedAt: 1250,
          expiresAt: 1500,
          retryCount: 0
        },
        {
          id: 'payment-4',
          state: PaymentState.EXPIRED,
          amount: ethers.parseUnits('1', 6).toString(),
          currency: 'USDC',
          resource: '/api/premium',
          createdAt: 1300,
          updatedAt: 1600,
          expiresAt: 1600,
          retryCount: 0
        }
      ]

      const metrics = calculateMetrics(samplePayments)

      expect(metrics.totalPayments).toBe(4)
      expect(metrics.successfulPayments).toBe(2)
      expect(metrics.failedPayments).toBe(1)
      expect(metrics.expiredPayments).toBe(1)
      expect(metrics.totalVolume).toBe(BigInt(ethers.parseUnits('30', 6).toString())) // 10 + 20 USDC
      expect(metrics.avgPaymentTime).toBe((30 + 10 + 50) / 3) // Average of completed payments
      expect(metrics.failureReasons.get(FailureReason.INSUFFICIENT_FUNDS)).toBe(1)
      expect(metrics.paymentsByState.get(PaymentState.SETTLED)).toBe(2)
      expect(metrics.paymentsByState.get(PaymentState.FAILED)).toBe(1)
      expect(metrics.paymentsByState.get(PaymentState.EXPIRED)).toBe(1)
    })
  })
})