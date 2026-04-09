/**
 * Production-grade cryptographic validation for Sangria payments
 * Implements real EIP-712 signature verification and security checks
 */

import { ethers } from 'ethers'
import Decimal from 'decimal.js'

// Configure Decimal.js for financial precision (6 decimal places for USDC)
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -7,
  toExpPos: 21
})

export interface PaymentData {
  payment_id: string
  amount: Decimal // Use Decimal instead of number
  resource: string
  timestamp: number
  expires_at: number
  chain_id: number
  merchant_address: string
  nonce: string
}

export interface EIP712Domain {
  name: string
  version: string
  chainId: number
  verifyingContract: string
}

export interface PaymentSignature {
  v: number
  r: string
  s: string
  signature: string
}

export class CryptoValidator {
  private static instance: CryptoValidator
  private usedNonces = new Set<string>()
  private usedSignatures = new Set<string>()
  private paymentStates = new Map<string, 'PENDING' | 'COMPLETED' | 'FAILED'>()

  static getInstance(): CryptoValidator {
    if (!CryptoValidator.instance) {
      CryptoValidator.instance = new CryptoValidator()
    }
    return CryptoValidator.instance
  }

  /**
   * Generate a payment with real cryptographic data
   */
  generatePayment(params: {
    amount: string | number
    resource: string
    description?: string
    chainId: number
    merchantAddress: string
  }): PaymentData {
    // Use Decimal for precise amount handling
    const amount = new Decimal(params.amount)

    // Validate amount precision (max 6 decimals for USDC)
    if (amount.decimalPlaces() > 6) {
      throw new Error('Amount precision exceeds USDC limit of 6 decimals')
    }

    // Generate cryptographically secure nonce
    const nonce = ethers.hexlify(ethers.randomBytes(32))
    const payment_id = `payment_${Date.now()}_${ethers.hexlify(ethers.randomBytes(16))}`

    const payment: PaymentData = {
      payment_id,
      amount,
      resource: params.resource,
      timestamp: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      chain_id: params.chainId,
      merchant_address: params.merchantAddress,
      nonce
    }

    // Track payment state
    this.paymentStates.set(payment_id, 'PENDING')

    return payment
  }

  /**
   * Generate EIP-712 domain separator
   */
  generateEIP712Domain(chainId: number, verifyingContract: string): EIP712Domain {
    return {
      name: 'SangriaNet',
      version: '1',
      chainId,
      verifyingContract
    }
  }

  /**
   * Create EIP-712 typed data for payment
   */
  createEIP712TypedData(payment: PaymentData, domain: EIP712Domain) {
    return {
      domain,
      types: {
        Payment: [
          { name: 'payment_id', type: 'string' },
          { name: 'amount', type: 'uint256' },
          { name: 'resource', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
          { name: 'expires_at', type: 'uint256' },
          { name: 'merchant_address', type: 'address' },
          { name: 'nonce', type: 'bytes32' }
        ]
      },
      primaryType: 'Payment' as const,
      message: {
        payment_id: payment.payment_id,
        amount: this.toUSDCBaseUnits(payment.amount),
        resource: payment.resource,
        timestamp: payment.timestamp,
        expires_at: payment.expires_at,
        merchant_address: payment.merchant_address,
        nonce: payment.nonce
      }
    }
  }

  /**
   * Sign payment with EIP-712
   */
  async signPayment(
    payment: PaymentData,
    domain: EIP712Domain,
    privateKey: string
  ): Promise<PaymentSignature> {
    const wallet = new ethers.Wallet(privateKey)
    const typedData = this.createEIP712TypedData(payment, domain)

    const signature = await wallet.signTypedData(
      typedData.domain,
      typedData.types,
      typedData.message
    )

    const { v, r, s } = ethers.Signature.from(signature)

    return {
      v,
      r,
      s,
      signature
    }
  }

  /**
   * Verify payment signature with comprehensive security checks
   */
  async verifyPaymentSignature(
    payment: PaymentData,
    signature: PaymentSignature,
    domain: EIP712Domain,
    expectedSigner: string
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      // 1. Check signature replay
      if (this.usedSignatures.has(signature.signature)) {
        return { valid: false, error: 'SIGNATURE_REPLAY_ATTACK' }
      }

      // 2. Check nonce replay
      if (this.usedNonces.has(payment.nonce)) {
        return { valid: false, error: 'NONCE_REPLAY_ATTACK' }
      }

      // 3. Check payment expiry
      if (payment.expires_at < Math.floor(Date.now() / 1000)) {
        return { valid: false, error: 'PAYMENT_EXPIRED' }
      }

      // 4. Check payment state
      const currentState = this.paymentStates.get(payment.payment_id)
      if (currentState !== 'PENDING') {
        return { valid: false, error: 'PAYMENT_ALREADY_PROCESSED' }
      }

      // 5. Verify EIP-712 signature
      const typedData = this.createEIP712TypedData(payment, domain)
      const recoveredAddress = ethers.verifyTypedData(
        typedData.domain,
        typedData.types,
        typedData.message,
        signature.signature
      )

      // 6. Check signer matches expected
      if (recoveredAddress.toLowerCase() !== expectedSigner.toLowerCase()) {
        return { valid: false, error: 'INVALID_SIGNER' }
      }

      // 7. Verify domain separator matches chain
      const domainHash = ethers.TypedDataEncoder.hashDomain(domain)
      const expectedDomainHash = ethers.TypedDataEncoder.hashDomain({
        ...domain,
        chainId: payment.chain_id
      })

      if (domainHash !== expectedDomainHash) {
        return { valid: false, error: 'CHAIN_ID_MISMATCH' }
      }

      // 8. Mark as used to prevent replay
      this.usedSignatures.add(signature.signature)
      this.usedNonces.add(payment.nonce)
      this.paymentStates.set(payment.payment_id, 'COMPLETED')

      return { valid: true }

    } catch (error) {
      return { valid: false, error: `CRYPTO_ERROR: ${error.message}` }
    }
  }

  /**
   * Convert Decimal amount to USDC base units (6 decimals)
   */
  toUSDCBaseUnits(amount: Decimal): string {
    return amount.mul(new Decimal(10).pow(6)).toFixed(0)
  }

  /**
   * Convert USDC base units back to Decimal
   */
  fromUSDCBaseUnits(baseUnits: string): Decimal {
    return new Decimal(baseUnits).div(new Decimal(10).pow(6))
  }

  /**
   * Reset state for testing
   */
  resetState() {
    this.usedNonces.clear()
    this.usedSignatures.clear()
    this.paymentStates.clear()
  }

  /**
   * Get payment state
   */
  getPaymentState(paymentId: string): 'PENDING' | 'COMPLETED' | 'FAILED' | 'NOT_FOUND' {
    return this.paymentStates.get(paymentId) || 'NOT_FOUND'
  }
}

// Test constants with derived addresses
const merchantPrivateKey = '0x1234567890123456789012345678901234567890123456789012345678901234'
const userPrivateKey = '0x9876543210987654321098765432109876543210987654321098765432109876'

export const TEST_CONSTANTS = {
  PRIVATE_KEYS: {
    MERCHANT: merchantPrivateKey,
    USER: userPrivateKey
  },
  ADDRESSES: {
    MERCHANT: new ethers.Wallet(merchantPrivateKey).address,
    USER: new ethers.Wallet(userPrivateKey).address
  },
  CHAIN_IDS: {
    BASE_MAINNET: 8453,
    BASE_SEPOLIA: 84532
  },
  VERIFYING_CONTRACT: '0x1234567890123456789012345678901234567890'
}