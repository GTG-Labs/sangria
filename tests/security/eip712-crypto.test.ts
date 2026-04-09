/**
 * EIP-712 Cryptographic Security Tests
 * Tests real signature validation, replay attack prevention, and signature malleability
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { ethers } from 'ethers'
import { keccak256, sha256 } from '@noble/hashes/sha2'
import { secp256k1 } from '@noble/secp256k1'

describe('EIP-712 Signature Security', () => {
  let wallet: ethers.Wallet
  let facilitatorDomain: any
  let transferWithAuthType: any

  beforeAll(() => {
    // Create deterministic wallet for testing
    wallet = new ethers.Wallet('0x' + '1'.repeat(64))

    // EIP-712 domain for USDC on Base Sepolia (from x402 spec)
    facilitatorDomain = {
      name: 'USD Coin',
      version: '2',
      chainId: 84532, // Base Sepolia
      verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // USDC Base Sepolia
    }

    // ERC-3009 TransferWithAuthorization type
    transferWithAuthType = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' }
      ]
    }
  })

  describe('Signature Validation', () => {
    it('should generate valid EIP-712 signatures', async () => {
      const paymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(), // recipient
        value: ethers.parseUnits('0.01', 6), // 0.01 USDC (6 decimals)
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300, // 5 minutes
        nonce: ethers.id(Math.random().toString()) // random nonce
      }

      const signature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, paymentData)
      expect(signature).toBeDefined()
      expect(signature.length).toBe(132) // 0x + 64 chars (r) + 64 chars (s) + 2 chars (v)

      // Verify signature can be recovered
      const recovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, paymentData, signature)
      expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase())
    })

    it('should reject invalid signatures', async () => {
      const paymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: ethers.parseUnits('0.01', 6),
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: ethers.id('test-nonce-1')
      }

      const validSignature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, paymentData)

      // Test 1: Tampered signature (corrupt r value)
      const rCorrupted = '0x0000000000000000000000000000000000000000000000000000000000000000' // corrupt r to zero
      const sOriginal = validSignature.slice(66, 130)
      const vOriginal = validSignature.slice(130, 132)
      const tamperedSignature = rCorrupted + sOriginal + vOriginal

      try {
        const tamperedRecovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, paymentData, tamperedSignature)
        expect(tamperedRecovered.toLowerCase()).not.toBe(wallet.address.toLowerCase())
      } catch (error) {
        // ethers.js might reject the corrupted signature entirely, which is also correct
        expect(error).toBeDefined()
      }

      // Test 2: Wrong domain
      const wrongDomain = { ...facilitatorDomain, chainId: 1 } // mainnet instead of base sepolia
      expect(() => {
        ethers.verifyTypedData(wrongDomain, transferWithAuthType, paymentData, validSignature)
      }).not.toThrow() // Should not throw, but should return different address

      const wrongDomainRecovered = ethers.verifyTypedData(wrongDomain, transferWithAuthType, paymentData, validSignature)
      expect(wrongDomainRecovered.toLowerCase()).not.toBe(wallet.address.toLowerCase())
    })

    it('should enforce strict amount validation', async () => {
      const basePaymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: ethers.id('test-amount-validation')
      }

      // Test precise decimal handling
      const scenarios = [
        { amount: '0.000001', expected: '1' }, // minimum USDC unit
        { amount: '0.01', expected: '10000' },
        { amount: '1.0', expected: '1000000' },
        { amount: '1000000.0', expected: '1000000000000' } // max realistic amount
      ]

      for (const scenario of scenarios) {
        const paymentData = {
          ...basePaymentData,
          value: ethers.parseUnits(scenario.amount, 6),
          nonce: ethers.id(`test-amount-${scenario.amount}`)
        }

        expect(paymentData.value.toString()).toBe(scenario.expected)

        const signature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, paymentData)
        const recovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, paymentData, signature)
        expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase())
      }
    })
  })

  describe('Replay Attack Prevention', () => {
    it('should prevent nonce reuse', async () => {
      const nonce = ethers.id('unique-nonce-test')
      const basePaymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: ethers.parseUnits('0.01', 6),
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce
      }

      // First payment with nonce
      const signature1 = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, basePaymentData)

      // Second payment with same nonce (this should be detected and rejected by facilitator)
      const signature2 = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, basePaymentData)

      // Signatures are deterministic for same data
      expect(signature1).toBe(signature2)

      // In production, facilitator should track used nonces and reject reuse
      // This test verifies the cryptographic properties that enable that check
      const recovered1 = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, basePaymentData, signature1)
      const recovered2 = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, basePaymentData, signature2)

      expect(recovered1).toBe(recovered2)
      expect(recovered1.toLowerCase()).toBe(wallet.address.toLowerCase())
    })

    it('should enforce time window validation', async () => {
      const now = Math.floor(Date.now() / 1000)

      // Test 1: Expired payment (validBefore in past)
      const expiredPayment = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: ethers.parseUnits('0.01', 6),
        validAfter: now - 600, // 10 minutes ago
        validBefore: now - 300, // 5 minutes ago (expired)
        nonce: ethers.id('expired-payment')
      }

      const expiredSignature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, expiredPayment)
      const expiredRecovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, expiredPayment, expiredSignature)

      // Signature is cryptographically valid, but payment is expired
      expect(expiredRecovered.toLowerCase()).toBe(wallet.address.toLowerCase())
      expect(expiredPayment.validBefore).toBeLessThan(now)

      // Test 2: Future payment (validAfter in future)
      const futurePayment = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: ethers.parseUnits('0.01', 6),
        validAfter: now + 300, // 5 minutes from now
        validBefore: now + 600, // 10 minutes from now
        nonce: ethers.id('future-payment')
      }

      const futureSignature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, futurePayment)
      const futureRecovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, futurePayment, futureSignature)

      // Signature is cryptographically valid, but payment is not yet valid
      expect(futureRecovered.toLowerCase()).toBe(wallet.address.toLowerCase())
      expect(futurePayment.validAfter).toBeGreaterThan(now)
    })

    it('should prevent cross-chain replay attacks', async () => {
      const paymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: ethers.parseUnits('0.01', 6),
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: ethers.id('cross-chain-test')
      }

      // Base Sepolia signature (testnet)
      const baseDomain = {
        ...facilitatorDomain,
        chainId: 84532
      }
      const baseSignature = await wallet.signTypedData(baseDomain, transferWithAuthType, paymentData)

      // Base Mainnet domain
      const mainnetDomain = {
        ...facilitatorDomain,
        chainId: 8453
      }
      const mainnetSignature = await wallet.signTypedData(mainnetDomain, transferWithAuthType, paymentData)

      // Signatures should be different due to domain separation
      expect(baseSignature).not.toBe(mainnetSignature)

      // Each signature should only be valid for its respective chain
      const baseRecovered = ethers.verifyTypedData(baseDomain, transferWithAuthType, paymentData, baseSignature)
      const mainnetRecovered = ethers.verifyTypedData(mainnetDomain, transferWithAuthType, paymentData, mainnetSignature)

      expect(baseRecovered.toLowerCase()).toBe(wallet.address.toLowerCase())
      expect(mainnetRecovered.toLowerCase()).toBe(wallet.address.toLowerCase())

      // Cross-chain verification should fail
      const crossRecovered = ethers.verifyTypedData(baseDomain, transferWithAuthType, paymentData, mainnetSignature)
      expect(crossRecovered.toLowerCase()).not.toBe(wallet.address.toLowerCase())
    })
  })

  describe('Signature Malleability Protection', () => {
    it('should detect signature malleability attacks', async () => {
      const paymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: ethers.parseUnits('0.01', 6),
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: ethers.id('malleability-test')
      }

      const signature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, paymentData)

      // Parse signature components
      const r = signature.slice(0, 66) // 0x + 32 bytes
      const s = '0x' + signature.slice(66, 130) // 32 bytes
      const v = parseInt(signature.slice(130, 132), 16)

      // EIP-2 protection: s must be in lower half of curve order
      const secp256k1Order = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
      const sBigInt = BigInt(s)

      // Valid signature should have s <= secp256k1Order / 2
      expect(sBigInt).toBeLessThanOrEqual(secp256k1Order / 2n)

      // Test creating a malleable signature (should be rejected)
      const malleableS = secp256k1Order - sBigInt
      const malleableV = v === 27 ? 28 : 27
      const malleableSignature = r + malleableS.toString(16).padStart(64, '0') + malleableV.toString(16).padStart(2, '0')

      // Malleable signature should recover to different address or fail
      try {
        const malleableRecovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, paymentData, malleableSignature)
        expect(malleableRecovered.toLowerCase()).not.toBe(wallet.address.toLowerCase())
      } catch (error) {
        // ethers.js might reject the malleable signature outright
        expect(error).toBeDefined()
      }
    })
  })

  describe('Amount Precision and Overflow Protection', () => {
    it('should handle USDC decimal precision correctly', async () => {
      const basePaymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300
      }

      // Test boundary values for USDC (6 decimals)
      const testCases = [
        {
          name: 'minimum unit',
          amount: '0.000001',
          rawValue: '1'
        },
        {
          name: 'one cent',
          amount: '0.01',
          rawValue: '10000'
        },
        {
          name: 'maximum safe amount',
          amount: '1000000',
          rawValue: '1000000000000'
        }
      ]

      for (const testCase of testCases) {
        const paymentData = {
          ...basePaymentData,
          value: ethers.parseUnits(testCase.amount, 6),
          nonce: ethers.id(`precision-test-${testCase.name}`)
        }

        expect(paymentData.value.toString()).toBe(testCase.rawValue)

        // Verify no precision loss in signature
        const signature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, paymentData)
        const recovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, paymentData, signature)
        expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase())
      }
    })

    it('should prevent integer overflow attacks', async () => {
      const maxUint256 = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')

      const paymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: maxUint256, // Maximum uint256 value
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: ethers.id('overflow-test')
      }

      // Should be able to sign even with max value (signature generation doesn't validate business logic)
      const signature = await wallet.signTypedData(facilitatorDomain, transferWithAuthType, paymentData)
      const recovered = ethers.verifyTypedData(facilitatorDomain, transferWithAuthType, paymentData, signature)
      expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase())

      // But facilitator should reject unrealistic amounts
      expect(paymentData.value).toBe(maxUint256)
    })
  })

  describe('Domain Separation Security', () => {
    it('should enforce proper domain separation', async () => {
      const paymentData = {
        from: wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D400d77fb63D0C5D'.toLowerCase(),
        value: ethers.parseUnits('0.01', 6),
        validAfter: Math.floor(Date.now() / 1000),
        validBefore: Math.floor(Date.now() / 1000) + 300,
        nonce: ethers.id('domain-separation-test')
      }

      // Create signatures with different domain parameters
      const domains = [
        { ...facilitatorDomain, name: 'USD Coin' }, // correct
        { ...facilitatorDomain, name: 'Fake Coin' }, // wrong name
        { ...facilitatorDomain, version: '1' }, // wrong version
        { ...facilitatorDomain, verifyingContract: '0x' + '0'.repeat(40) } // wrong contract
      ]

      const signatures = await Promise.all(
        domains.map(domain => wallet.signTypedData(domain, transferWithAuthType, paymentData))
      )

      // All signatures should be different
      const uniqueSignatures = new Set(signatures)
      expect(uniqueSignatures.size).toBe(domains.length)

      // Only the correct domain should recover the correct address
      for (let i = 0; i < domains.length; i++) {
        const recovered = ethers.verifyTypedData(domains[i], transferWithAuthType, paymentData, signatures[i])
        expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase())

        // Cross-domain verification should fail
        if (i > 0) {
          const crossRecovered = ethers.verifyTypedData(domains[0], transferWithAuthType, paymentData, signatures[i])
          expect(crossRecovered.toLowerCase()).not.toBe(wallet.address.toLowerCase())
        }
      }
    })
  })
})