/**
 * Decimal Precision and Financial Validation Tests
 * Critical tests for financial accuracy and proper money handling
 */

import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'

describe('Financial Precision and Validation', () => {
  describe('USDC Decimal Precision', () => {
    it('should handle USDC 6-decimal precision correctly', () => {
      // USDC has 6 decimal places (unlike ETH which has 18)
      const testAmounts = [
        { decimal: '0.000001', expected: '1', description: 'minimum USDC unit (1 microUSDC)' },
        { decimal: '0.00001', expected: '10', description: '10 microUSDC' },
        { decimal: '0.0001', expected: '100', description: '100 microUSDC' },
        { decimal: '0.001', expected: '1000', description: '1 milliUSDC' },
        { decimal: '0.01', expected: '10000', description: '1 cent' },
        { decimal: '0.1', expected: '100000', description: '10 cents' },
        { decimal: '1.0', expected: '1000000', description: '1 USDC' },
        { decimal: '10.0', expected: '10000000', description: '10 USDC' },
        { decimal: '100.0', expected: '100000000', description: '100 USDC' },
        { decimal: '1000.0', expected: '1000000000', description: '1000 USDC' },
        { decimal: '1000000.0', expected: '1000000000000', description: '1 million USDC' }
      ]

      for (const test of testAmounts) {
        const parsed = ethers.parseUnits(test.decimal, 6)
        expect(parsed.toString()).toBe(test.expected)

        // Verify round-trip conversion
        const formatted = ethers.formatUnits(parsed, 6)
        expect(formatted).toBe(test.decimal)
      }
    })

    it('should reject amounts with too many decimals', () => {
      const invalidAmounts = [
        '0.0000001', // 7 decimals (too many for USDC)
        '0.0000000001', // 10 decimals
        '1.0000001', // Valid integer part but too many decimals
        '123.1234567' // Too many decimals
      ]

      for (const amount of invalidAmounts) {
        expect(() => ethers.parseUnits(amount, 6)).toThrow()
      }
    })

    it('should handle edge cases and boundary values', () => {
      // Test maximum safe USDC amount (limited by uint256)
      const maxUint256 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
      expect(maxUint256).toBeDefined()

      // Test practical maximum USDC amount (total supply constraint)
      // Current USDC total supply is around 100 billion, so test with 1 trillion as upper bound
      const practicalMax = ethers.parseUnits('1000000000000', 6) // 1 trillion USDC
      expect(practicalMax).toBe(BigInt('1000000000000000000'))

      // Test minimum non-zero amount
      const minimum = ethers.parseUnits('0.000001', 6)
      expect(minimum).toBe(BigInt('1'))

      // Test zero (valid but should be handled specially)
      const zero = ethers.parseUnits('0', 6)
      expect(zero).toBe(BigInt('0'))
    })

    it('should preserve precision in arithmetic operations', () => {
      // Test addition
      const amount1 = ethers.parseUnits('1.123456', 6) // 1,123,456 microUSDC
      const amount2 = ethers.parseUnits('2.654321', 6) // 2,654,321 microUSDC
      const sum = amount1 + amount2

      expect(ethers.formatUnits(sum, 6)).toBe('3.777777')

      // Test subtraction
      const difference = amount2 - amount1
      expect(ethers.formatUnits(difference, 6)).toBe('1.530865')

      // Test multiplication (with precision loss awareness)
      const multiplied = amount1 * BigInt(2)
      expect(ethers.formatUnits(multiplied, 6)).toBe('2.246912')

      // Test division (careful with remainder)
      const divided = amount2 / BigInt(2)
      expect(ethers.formatUnits(divided, 6)).toBe('1.32716') // Note: 1 microUSDC lost to rounding
    })
  })

  describe('Amount Validation Rules', () => {
    it('should enforce minimum payment amounts', () => {
      const validateAmount = (amountStr: string): { valid: boolean; reason?: string } => {
        try {
          const amount = BigInt(amountStr)

          // Business rules for payment amounts
          const MIN_PAYMENT = BigInt('1') // 0.000001 USDC (1 microUSDC)
          const MAX_PAYMENT = BigInt('1000000000000') // 1 million USDC
          const DUST_THRESHOLD = BigInt('100') // 0.0001 USDC (avoid dust payments)

          if (amount <= 0) {
            return { valid: false, reason: 'Amount must be positive' }
          }

          if (amount < MIN_PAYMENT) {
            return { valid: false, reason: 'Amount below minimum' }
          }

          if (amount > MAX_PAYMENT) {
            return { valid: false, reason: 'Amount exceeds maximum' }
          }

          if (amount < DUST_THRESHOLD) {
            return { valid: false, reason: 'Amount too small (dust payment)' }
          }

          return { valid: true }
        } catch (error) {
          return { valid: false, reason: 'Invalid amount format' }
        }
      }

      // Test valid amounts
      expect(validateAmount('100')).toEqual({ valid: true }) // 0.0001 USDC
      expect(validateAmount('10000')).toEqual({ valid: true }) // 0.01 USDC
      expect(validateAmount('1000000000000')).toEqual({ valid: true }) // 1M USDC

      // Test invalid amounts
      expect(validateAmount('0')).toEqual({ valid: false, reason: 'Amount must be positive' })
      expect(validateAmount('-1')).toEqual({ valid: false, reason: 'Amount must be positive' })
      expect(validateAmount('1')).toEqual({ valid: false, reason: 'Amount too small (dust payment)' })
      expect(validateAmount('1000000000001')).toEqual({ valid: false, reason: 'Amount exceeds maximum' })
      expect(validateAmount('abc')).toEqual({ valid: false, reason: 'Invalid amount format' })
    })

    it('should detect and prevent integer overflow attacks', () => {
      const testOverflow = (a: string, b: string): { safe: boolean; result?: string } => {
        try {
          const bigA = BigInt(a)
          const bigB = BigInt(b)
          const sum = bigA + bigB

          // Check for overflow by comparing with maximum safe value
          const MAX_SAFE = BigInt('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')

          if (sum > MAX_SAFE) {
            return { safe: false }
          }

          return { safe: true, result: sum.toString() }
        } catch (error) {
          return { safe: false }
        }
      }

      // Test safe additions
      const result1 = testOverflow('1000000', '2000000')
      expect(result1.safe).toBe(true)
      expect(result1.result).toBe('3000000')

      // Test potential overflow
      const maxValue = '0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      const result2 = testOverflow(maxValue, '1')
      expect(result2.safe).toBe(false)

      // Test realistic large amounts
      const largeAmount1 = ethers.parseUnits('999999999', 6).toString()
      const largeAmount2 = ethers.parseUnits('1', 6).toString()
      const result3 = testOverflow(largeAmount1, largeAmount2)
      expect(result3.safe).toBe(true)
    })

    it('should validate amount relationships and constraints', () => {
      interface PaymentConstraints {
        minAmount: bigint
        maxAmount: bigint
        maxDaily: bigint
        maxPerTransaction: bigint
      }

      const constraints: PaymentConstraints = {
        minAmount: BigInt('100'), // 0.0001 USDC
        maxAmount: BigInt('100000000'), // 100 USDC per transaction
        maxDaily: BigInt('1000000000'), // 1000 USDC per day
        maxPerTransaction: BigInt('100000000') // 100 USDC
      }

      const validatePaymentConstraints = (
        amount: bigint,
        dailyTotal: bigint = BigInt('0'),
        userTier: 'basic' | 'premium' | 'enterprise' = 'basic'
      ): { valid: boolean; reason?: string } => {
        // Adjust limits based on user tier
        let effectiveMax = constraints.maxAmount
        let effectiveDailyMax = constraints.maxDaily

        switch (userTier) {
          case 'premium':
            effectiveMax = constraints.maxAmount * BigInt(5)
            effectiveDailyMax = constraints.maxDaily * BigInt(5)
            break
          case 'enterprise':
            effectiveMax = constraints.maxAmount * BigInt(100)
            effectiveDailyMax = constraints.maxDaily * BigInt(100)
            break
        }

        if (amount < constraints.minAmount) {
          return { valid: false, reason: 'Amount below minimum' }
        }

        if (amount > effectiveMax) {
          return { valid: false, reason: 'Amount exceeds transaction limit' }
        }

        if (dailyTotal + amount > effectiveDailyMax) {
          return { valid: false, reason: 'Amount exceeds daily limit' }
        }

        return { valid: true }
      }

      // Test basic constraints
      const validAmount = BigInt('10000') // 0.01 USDC
      expect(validatePaymentConstraints(validAmount)).toEqual({ valid: true })

      // Test minimum violation
      expect(validatePaymentConstraints(BigInt('50')))
        .toEqual({ valid: false, reason: 'Amount below minimum' })

      // Test transaction limit
      expect(validatePaymentConstraints(BigInt('200000000'))) // 200 USDC
        .toEqual({ valid: false, reason: 'Amount exceeds transaction limit' })

      // Test daily limit
      const dailyTotal = BigInt('950000000') // 950 USDC already spent today
      expect(validatePaymentConstraints(BigInt('100000000'), dailyTotal)) // 100 USDC more
        .toEqual({ valid: false, reason: 'Amount exceeds daily limit' })

      // Test tier-based limits
      expect(validatePaymentConstraints(BigInt('200000000'), BigInt('0'), 'premium'))
        .toEqual({ valid: true }) // 200 USDC allowed for premium

      expect(validatePaymentConstraints(BigInt('10000000000'), BigInt('0'), 'enterprise'))
        .toEqual({ valid: true }) // 10,000 USDC allowed for enterprise
    })
  })

  describe('Financial Calculations', () => {
    it('should calculate fees with proper precision', () => {
      const calculateFee = (amount: bigint, feeBasisPoints: number): bigint => {
        // Fee calculation using basis points (1 basis point = 0.01%)
        // Example: 250 basis points = 2.5%
        const fee = (amount * BigInt(feeBasisPoints)) / BigInt(10000)
        return fee
      }

      // Test various fee calculations
      const testCases = [
        {
          amount: ethers.parseUnits('100', 6), // 100 USDC
          feeBps: 250, // 2.5%
          expectedFee: ethers.parseUnits('2.5', 6) // 2.5 USDC
        },
        {
          amount: ethers.parseUnits('0.01', 6), // 0.01 USDC (1 cent)
          feeBps: 300, // 3%
          expectedFee: BigInt('300') // 0.0003 USDC
        },
        {
          amount: ethers.parseUnits('1000', 6), // 1000 USDC
          feeBps: 50, // 0.5%
          expectedFee: ethers.parseUnits('5', 6) // 5 USDC
        }
      ]

      for (const testCase of testCases) {
        const calculatedFee = calculateFee(testCase.amount, testCase.feeBps)
        expect(calculatedFee).toBe(testCase.expectedFee)

        // Verify net amount calculation
        const netAmount = testCase.amount - calculatedFee
        const totalCheck = netAmount + calculatedFee
        expect(totalCheck).toBe(testCase.amount) // Should equal original amount
      }
    })

    it('should handle rounding and precision in fee calculations', () => {
      // Test edge cases where fee calculations might have remainder
      const amount = ethers.parseUnits('0.333333', 6) // 333,333 microUSDC
      const feeBasisPoints = 333 // 3.33%

      const fee = (amount * BigInt(feeBasisPoints)) / BigInt(10000)
      const remainder = (amount * BigInt(feeBasisPoints)) % BigInt(10000)

      // Calculate expected values: 333333 * 333 = 110,999,889, 110,999,889 / 10000 = 11099.9889
      // So fee = 11099, remainder = 9889
      expect(fee.toString()).toBe('11099') // Truncated result
      expect(remainder.toString()).toBe('9889') // Remainder that was truncated

      // Test that we don't lose money due to rounding
      const netAmount = amount - fee
      expect(netAmount + fee).toBe(amount) // Should still equal original
      expect(netAmount + fee + (remainder / BigInt(10000))).toBeLessThanOrEqual(amount)
    })

    it('should validate payment splitting and reconciliation', () => {
      const splitPayment = (
        totalAmount: bigint,
        splits: { address: string; percentage: number }[]
      ): { address: string; amount: bigint }[] => {
        // Validate percentages sum to 100
        const totalPercentage = splits.reduce((sum, split) => sum + split.percentage, 0)
        if (Math.abs(totalPercentage - 100) > 0.01) {
          throw new Error('Split percentages must sum to 100%')
        }

        const results: { address: string; amount: bigint }[] = []
        let distributed = BigInt('0')

        // Calculate splits, handling the last one specially to avoid rounding errors
        for (let i = 0; i < splits.length - 1; i++) {
          const split = splits[i]
          const amount = (totalAmount * BigInt(Math.round(split.percentage * 100))) / BigInt(10000)
          results.push({ address: split.address, amount })
          distributed += amount
        }

        // Last split gets remainder to ensure exact total
        const lastSplit = splits[splits.length - 1]
        const lastAmount = totalAmount - distributed
        results.push({ address: lastSplit.address, amount: lastAmount })

        return results
      }

      // Test payment splitting
      const totalPayment = ethers.parseUnits('100', 6) // 100 USDC
      const splits = [
        { address: '0x1111111111111111111111111111111111111111', percentage: 50 }, // 50%
        { address: '0x2222222222222222222222222222222222222222', percentage: 30 }, // 30%
        { address: '0x3333333333333333333333333333333333333333', percentage: 20 }  // 20%
      ]

      const splitResult = splitPayment(totalPayment, splits)

      // Verify split amounts
      expect(splitResult[0].amount).toBe(ethers.parseUnits('50', 6)) // 50 USDC
      expect(splitResult[1].amount).toBe(ethers.parseUnits('30', 6)) // 30 USDC
      expect(splitResult[2].amount).toBe(ethers.parseUnits('20', 6)) // 20 USDC

      // Verify total reconciliation
      const totalDistributed = splitResult.reduce((sum, split) => sum + split.amount, BigInt('0'))
      expect(totalDistributed).toBe(totalPayment)

      // Test with odd percentages that might cause rounding issues
      const oddSplits = [
        { address: '0x1111111111111111111111111111111111111111', percentage: 33.33 },
        { address: '0x2222222222222222222222222222222222222222', percentage: 33.33 },
        { address: '0x3333333333333333333333333333333333333333', percentage: 33.34 }
      ]

      const oddSplitResult = splitPayment(totalPayment, oddSplits)
      const oddTotalDistributed = oddSplitResult.reduce((sum, split) => sum + split.amount, BigInt('0'))

      // Should still equal total despite rounding
      expect(oddTotalDistributed).toBe(totalPayment)
    })
  })

  describe('Currency Conversion and Exchange Rates', () => {
    it('should handle multi-currency calculations with precision', () => {
      // Simulate exchange rate handling (would normally come from oracle)
      interface ExchangeRate {
        from: string
        to: string
        rate: bigint // Rate with 8 decimal places (like Chainlink)
        decimals: number
      }

      // Simplified currency conversion using ethers.js directly
      // Example: Convert 100 USDC to ETH where 1 ETH = 2000 USDC
      const exchangeRate = 2000 // 1 ETH = 2000 USDC

      const convertUSDCtoETH = (usdcAmount: bigint, rate: number): bigint => {
        // Convert USDC to ETH: ethAmount = usdcAmount / rate
        // First convert to float for division, then back to bigint
        const usdcFloat = parseFloat(ethers.formatUnits(usdcAmount, 6))
        const ethFloat = usdcFloat / rate
        return ethers.parseUnits(ethFloat.toString(), 18)
      }

      const usdcAmount = ethers.parseUnits('100', 6) // 100 USDC
      const ethAmount = convertUSDCtoETH(usdcAmount, exchangeRate)

      // Should get 0.05 ETH (100 USDC / 2000)
      expect(ethAmount).toBe(ethers.parseUnits('0.05', 18))
      expect(ethers.formatUnits(ethAmount, 18)).toBe('0.05')
    })
  })

  describe('Audit Trail and Financial Reporting', () => {
    it('should maintain precise audit trails for all amounts', () => {
      interface AuditEntry {
        id: string
        timestamp: number
        type: 'payment' | 'fee' | 'refund' | 'settlement'
        amount: string
        currency: string
        from?: string
        to?: string
        transactionHash?: string
        blockNumber?: number
        gasUsed?: string
        gasPrice?: string
      }

      const auditTrail: AuditEntry[] = []

      const recordAuditEntry = (entry: Omit<AuditEntry, 'id' | 'timestamp'>): void => {
        auditTrail.push({
          id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Math.floor(Date.now() / 1000),
          ...entry
        })
      }

      // Record a series of financial operations
      recordAuditEntry({
        type: 'payment',
        amount: ethers.parseUnits('100', 6).toString(),
        currency: 'USDC',
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222'
      })

      recordAuditEntry({
        type: 'fee',
        amount: ethers.parseUnits('2.5', 6).toString(),
        currency: 'USDC',
        to: '0x3333333333333333333333333333333333333333'
      })

      recordAuditEntry({
        type: 'settlement',
        amount: ethers.parseUnits('97.5', 6).toString(),
        currency: 'USDC',
        transactionHash: '0xabcd1234567890abcdef',
        blockNumber: 12345678
      })

      // Verify audit trail
      expect(auditTrail.length).toBe(3)

      // Verify amounts sum correctly
      const totalPayment = BigInt(auditTrail[0].amount)
      const totalFee = BigInt(auditTrail[1].amount)
      const totalSettled = BigInt(auditTrail[2].amount)

      expect(totalPayment).toBe(totalFee + totalSettled)

      // Verify all amounts are in correct precision
      auditTrail.forEach(entry => {
        if (entry.currency === 'USDC') {
          const amount = BigInt(entry.amount)
          // Should be valid USDC amount (positive integer)
          expect(amount).toBeGreaterThan(BigInt('0'))
          expect(amount.toString()).toMatch(/^\d+$/)
        }
      })
    })
  })
})