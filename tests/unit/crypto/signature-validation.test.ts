/**
 * Production-grade cryptographic validation tests
 * Tests real EIP-712 signatures, replay attacks, and financial precision
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ethers } from 'ethers'
import Decimal from 'decimal.js'
import { CryptoValidator, TEST_CONSTANTS } from '../../utils/crypto-validation.js'

describe('Cryptographic Signature Validation', () => {
  let validator: CryptoValidator

  beforeEach(() => {
    validator = CryptoValidator.getInstance()
    validator.resetState()
  })

  describe('Payment Generation Security', () => {
    it('should generate cryptographically secure payment IDs', () => {
      const payment1 = validator.generatePayment({
        amount: '0.01',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const payment2 = validator.generatePayment({
        amount: '0.01',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // Payment IDs should be unique
      expect(payment1.payment_id).not.toBe(payment2.payment_id)
      expect(payment1.nonce).not.toBe(payment2.nonce)

      // Should follow correct format
      expect(payment1.payment_id).toMatch(/^payment_\d+_0x[a-f0-9]{32}$/)
      expect(payment1.nonce).toMatch(/^0x[a-f0-9]{64}$/)
    })

    it('should enforce USDC decimal precision limits', () => {
      // Valid precision (6 decimals)
      expect(() => {
        validator.generatePayment({
          amount: '123.123456',
          resource: '/api/test',
          chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
          merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
        })
      }).not.toThrow()

      // Invalid precision (7+ decimals)
      expect(() => {
        validator.generatePayment({
          amount: '123.1234567',
          resource: '/api/test',
          chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
          merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
        })
      }).toThrow('Amount precision exceeds USDC limit of 6 decimals')
    })

    it('should correctly convert to USDC base units', () => {
      const testCases = [
        { decimal: '0.000001', baseUnits: '1' },
        { decimal: '0.01', baseUnits: '10000' },
        { decimal: '1', baseUnits: '1000000' },
        { decimal: '1000.123456', baseUnits: '1000123456' }
      ]

      testCases.forEach(({ decimal, baseUnits }) => {
        const amount = new Decimal(decimal)
        const result = validator.toUSDCBaseUnits(amount)
        expect(result).toBe(baseUnits)

        // Test round-trip conversion
        const backToDecimal = validator.fromUSDCBaseUnits(baseUnits)
        expect(backToDecimal.toString()).toBe(decimal)
      })
    })
  })

  describe('EIP-712 Signature Generation', () => {
    it('should create valid EIP-712 typed data structure', () => {
      const payment = validator.generatePayment({
        amount: '1.50',
        resource: 'https://example.com/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const typedData = validator.createEIP712TypedData(payment, domain)

      // Verify domain structure
      expect(typedData.domain.name).toBe('SangriaNet')
      expect(typedData.domain.version).toBe('1')
      expect(typedData.domain.chainId).toBe(TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET)

      // Verify message data
      expect(typedData.message.payment_id).toBe(payment.payment_id)
      expect(typedData.message.amount).toBe('1500000') // 1.50 USDC in base units
      expect(typedData.message.merchant_address).toBe(TEST_CONSTANTS.ADDRESSES.MERCHANT)

      // Verify types structure
      expect(typedData.types.Payment).toHaveLength(7)
      expect(typedData.primaryType).toBe('Payment')
    })

    it('should generate valid EIP-712 signatures', async () => {
      const payment = validator.generatePayment({
        amount: '0.01',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature = await validator.signPayment(payment, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      // Verify signature format
      expect(signature.signature).toMatch(/^0x[a-f0-9]{130}$/)
      expect(signature.r).toMatch(/^0x[a-f0-9]{64}$/)
      expect(signature.s).toMatch(/^0x[a-f0-9]{64}$/)
      expect(typeof signature.v).toBe('number')
    })
  })

  describe('Signature Verification Security', () => {
    it('should verify valid signatures correctly', async () => {
      const payment = validator.generatePayment({
        amount: '2.50',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature = await validator.signPayment(payment, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      const verification = await validator.verifyPaymentSignature(
        payment,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )

      expect(verification.valid).toBe(true)
      expect(verification.error).toBeUndefined()
    })

    it('should reject signatures from wrong signer', async () => {
      const payment = validator.generatePayment({
        amount: '1.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      // Sign with USER key but expect MERCHANT address
      const signature = await validator.signPayment(payment, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      const verification = await validator.verifyPaymentSignature(
        payment,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.MERCHANT // Wrong expected signer
      )

      expect(verification.valid).toBe(false)
      expect(verification.error).toBe('INVALID_SIGNER')
    })

    it('should prevent signature replay attacks', async () => {
      const payment = validator.generatePayment({
        amount: '5.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature = await validator.signPayment(payment, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      // First verification should succeed
      const firstVerification = await validator.verifyPaymentSignature(
        payment,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )
      expect(firstVerification.valid).toBe(true)

      // Second verification should fail (replay attack)
      const secondVerification = await validator.verifyPaymentSignature(
        payment,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )
      expect(secondVerification.valid).toBe(false)
      expect(secondVerification.error).toBe('SIGNATURE_REPLAY_ATTACK')
    })

    it('should prevent nonce replay attacks', async () => {
      // Create two payments with same parameters
      const payment1 = validator.generatePayment({
        amount: '1.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // Manually create second payment with same nonce
      const payment2 = {
        ...payment1,
        payment_id: 'payment_different_id'
      }

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature1 = await validator.signPayment(payment1, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)
      const signature2 = await validator.signPayment(payment2, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      // First verification should succeed
      const firstVerification = await validator.verifyPaymentSignature(
        payment1,
        signature1,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )
      expect(firstVerification.valid).toBe(true)

      // Second verification with same nonce should fail
      const secondVerification = await validator.verifyPaymentSignature(
        payment2,
        signature2,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )
      expect(secondVerification.valid).toBe(false)
      expect(secondVerification.error).toBe('NONCE_REPLAY_ATTACK')
    })

    it('should reject expired payments', async () => {
      const payment = validator.generatePayment({
        amount: '1.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // Manually set expiry to past
      payment.expires_at = Math.floor(Date.now() / 1000) - 1

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature = await validator.signPayment(payment, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      const verification = await validator.verifyPaymentSignature(
        payment,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )

      expect(verification.valid).toBe(false)
      expect(verification.error).toBe('PAYMENT_EXPIRED')
    })

    it('should detect chain ID mismatches', async () => {
      const payment = validator.generatePayment({
        amount: '1.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // Create domain with different chain ID
      const wrongDomain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_SEPOLIA, // Different chain
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature = await validator.signPayment(payment, wrongDomain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      const verification = await validator.verifyPaymentSignature(
        payment,
        signature,
        wrongDomain,
        TEST_CONSTANTS.ADDRESSES.USER
      )

      expect(verification.valid).toBe(false)
      expect(verification.error).toBe('CHAIN_ID_MISMATCH')
    })

    it('should prevent double-spending through payment state tracking', async () => {
      const payment = validator.generatePayment({
        amount: '10.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      expect(validator.getPaymentState(payment.payment_id)).toBe('PENDING')

      const domain = validator.generateEIP712Domain(
        TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        TEST_CONSTANTS.VERIFYING_CONTRACT
      )

      const signature = await validator.signPayment(payment, domain, TEST_CONSTANTS.PRIVATE_KEYS.USER)

      // First verification should succeed and mark as COMPLETED
      const firstVerification = await validator.verifyPaymentSignature(
        payment,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )
      expect(firstVerification.valid).toBe(true)
      expect(validator.getPaymentState(payment.payment_id)).toBe('COMPLETED')

      // Create new signature for same payment (different from replay attack test)
      validator.resetState()
      validator.generatePayment({
        amount: '10.00',
        resource: '/api/premium',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      // Manually set the payment state to completed to simulate double-spend attempt
      validator['paymentStates'].set(payment.payment_id, 'COMPLETED')

      const doubleSpendVerification = await validator.verifyPaymentSignature(
        payment,
        signature,
        domain,
        TEST_CONSTANTS.ADDRESSES.USER
      )
      expect(doubleSpendVerification.valid).toBe(false)
      expect(doubleSpendVerification.error).toBe('PAYMENT_ALREADY_PROCESSED')
    })
  })

  describe('Financial Precision Edge Cases', () => {
    it('should handle large USDC amounts correctly', () => {
      // Large but realistic USDC amount
      const largeUSDC = '1000000000.123456' // 1 billion USDC

      expect(() => {
        validator.generatePayment({
          amount: largeUSDC,
          resource: '/api/test',
          chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
          merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
        })
      }).not.toThrow()

      const baseUnits = validator.toUSDCBaseUnits(new Decimal(largeUSDC))
      expect(baseUnits).toBe('1000000000123456')
    })

    it('should handle minimum USDC amounts correctly', () => {
      const minUSDC = '0.000001' // 1 µUSDC

      const payment = validator.generatePayment({
        amount: minUSDC,
        resource: '/api/test',
        chainId: TEST_CONSTANTS.CHAIN_IDS.BASE_MAINNET,
        merchantAddress: TEST_CONSTANTS.ADDRESSES.MERCHANT
      })

      expect(payment.amount.toString()).toBe(minUSDC)
      expect(validator.toUSDCBaseUnits(payment.amount)).toBe('1')
    })

    it('should maintain precision through mathematical operations', () => {
      const amounts = ['0.1', '0.2', '0.3']
      let total = new Decimal(0)

      amounts.forEach(amount => {
        total = total.plus(new Decimal(amount))
      })

      // This should equal exactly 0.6, not 0.6000000000000001 like JavaScript numbers
      expect(total.toString()).toBe('0.6')
      expect(validator.toUSDCBaseUnits(total)).toBe('600000')
    })
  })
})