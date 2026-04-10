/**
 * Mock response fixtures for Sangria TypeScript SDK tests.
 */

import type {
  PaymentResult,
  X402ChallengePayload,
  SangriaRequestData
} from '../../../sdk/sdk-typescript/src/types.js'

// Mock X402 challenge payloads
export const mockX402Challenges: Record<string, X402ChallengePayload> = {
  basic: {
    payment_id: 'pay_basic_test_123',
    amount: 10.00,
    currency: 'USD',
    payment_url: 'https://pay.sangria.net/pay_basic_test_123',
    expires_at: '2024-01-01T13:00:00Z'
  },

  premium: {
    payment_id: 'pay_premium_test_456',
    amount: 25.99,
    currency: 'USD',
    payment_url: 'https://pay.sangria.net/pay_premium_test_456',
    expires_at: '2024-01-01T13:30:00Z',
    metadata: {
      tier: 'premium',
      features: ['advanced_analytics', 'priority_support']
    }
  },

  microPayment: {
    payment_id: 'pay_micro_test_789',
    amount: 0.01,
    currency: 'USD',
    payment_url: 'https://pay.sangria.net/pay_micro_test_789',
    expires_at: '2024-01-01T12:15:00Z',
    metadata: {
      type: 'micro_payment'
    }
  },

  largePayment: {
    payment_id: 'pay_large_test_999',
    amount: 999.99,
    currency: 'USD',
    payment_url: 'https://pay.sangria.net/pay_large_test_999',
    expires_at: '2024-01-01T14:00:00Z',
    metadata: {
      type: 'large_payment',
      requires_approval: true
    }
  }
}

// Mock successful payment results
export const mockSuccessfulPaymentResults: Record<string, PaymentResult> = {
  basicSuccess: {
    action: 'proceed',
    data: {
      paid: true,
      amount: 10.00,
      transaction: 'tx_basic_success_abc123'
    }
  },

  premiumSuccess: {
    action: 'proceed',
    data: {
      paid: true,
      amount: 25.99,
      transaction: 'tx_premium_success_def456'
    }
  },

  successWithoutTransaction: {
    action: 'proceed',
    data: {
      paid: true,
      amount: 15.50
    }
  },

  freeBypass: {
    action: 'proceed',
    data: {
      paid: false,
      amount: 0
    }
  }
}

// Mock payment required responses
export const mockPaymentRequiredResults: Record<string, PaymentResult> = {
  basic402: {
    action: 'respond',
    status: 402,
    body: mockX402Challenges.basic,
    headers: {
      'PAYMENT-REQUIRED': btoa(JSON.stringify(mockX402Challenges.basic))
    }
  },

  premium402: {
    action: 'respond',
    status: 402,
    body: mockX402Challenges.premium,
    headers: {
      'PAYMENT-REQUIRED': btoa(JSON.stringify(mockX402Challenges.premium)),
      'X-Payment-Provider': 'Sangria',
      'Cache-Control': 'no-cache'
    }
  },

  micro402: {
    action: 'respond',
    status: 402,
    body: mockX402Challenges.microPayment,
    headers: {
      'PAYMENT-REQUIRED': btoa(JSON.stringify(mockX402Challenges.microPayment))
    }
  }
}

// Mock error responses
export const mockErrorResults: Record<string, PaymentResult> = {
  paymentServiceUnavailable: {
    action: 'respond',
    status: 500,
    body: {
      error: 'Payment service unavailable'
    }
  },

  paymentSettlementFailed: {
    action: 'respond',
    status: 500,
    body: {
      error: 'Payment settlement failed'
    }
  },

  invalidSignature: {
    action: 'respond',
    status: 402,
    body: {
      error: 'Payment verification failed',
      error_reason: 'invalid_signature'
    }
  },

  insufficientFunds: {
    action: 'respond',
    status: 402,
    body: {
      error: 'Insufficient funds',
      error_reason: 'insufficient_balance'
    }
  },

  expiredPayment: {
    action: 'respond',
    status: 402,
    body: {
      error: 'Payment expired',
      error_reason: 'payment_expired'
    }
  },

  paymentTimeout: {
    action: 'respond',
    status: 402,
    body: {
      error: 'Payment timeout',
      error_reason: 'timeout'
    }
  }
}

// Mock Sangria request data for framework integration
export const mockSangriaRequestData: Record<string, SangriaRequestData> = {
  paidBasic: {
    paid: true,
    amount: 10.00,
    transaction: 'tx_basic_framework_123'
  },

  paidPremium: {
    paid: true,
    amount: 25.99,
    transaction: 'tx_premium_framework_456'
  },

  paidWithoutTransaction: {
    paid: true,
    amount: 8.50
  },

  unpaidBypass: {
    paid: false,
    amount: 0
  }
}

// Utility functions to create custom mock responses
export function createMockX402Challenge(
  paymentId: string,
  amount: number,
  additionalData?: Partial<X402ChallengePayload>
): X402ChallengePayload {
  return {
    payment_id: paymentId,
    amount,
    currency: 'USD',
    payment_url: `https://pay.sangria.net/${paymentId}`,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    ...additionalData
  }
}

export function createMockPaymentRequiredResult(
  challenge: X402ChallengePayload,
  additionalHeaders?: Record<string, string>
): PaymentResult {
  return {
    action: 'respond',
    status: 402,
    body: challenge,
    headers: {
      'PAYMENT-REQUIRED': btoa(JSON.stringify(challenge)),
      ...additionalHeaders
    }
  }
}

export function createMockSuccessResult(
  amount: number,
  transaction?: string
): PaymentResult {
  return {
    action: 'proceed',
    data: {
      paid: true,
      amount,
      ...(transaction && { transaction })
    }
  }
}

export function createMockErrorResult(
  status: number,
  error: string,
  errorReason?: string
): PaymentResult {
  return {
    action: 'respond',
    status,
    body: {
      error,
      ...(errorReason && { error_reason: errorReason })
    }
  }
}

// Helper to encode X402 challenge as base64
export function encodeX402Challenge(challenge: X402ChallengePayload): string {
  return btoa(JSON.stringify(challenge))
}

// Helper to decode X402 challenge from base64
export function decodeX402Challenge(encoded: string): X402ChallengePayload {
  return JSON.parse(atob(encoded))
}

export default {
  mockX402Challenges,
  mockSuccessfulPaymentResults,
  mockPaymentRequiredResults,
  mockErrorResults,
  mockSangriaRequestData,
  createMockX402Challenge,
  createMockPaymentRequiredResult,
  createMockSuccessResult,
  createMockErrorResult,
  encodeX402Challenge,
  decodeX402Challenge
}