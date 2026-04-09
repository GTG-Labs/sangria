/**
 * Mock backend responses for testing
 * Provides realistic API responses for all test scenarios
 */

export const mockResponses = {
  // Health check response
  health: {
    healthy: () => ({
      status: 'healthy',
      timestamp: Math.floor(Date.now() / 1000),
      version: '1.0.0',
      uptime: 12345
    })
  },
  // Payment generation responses
  generatePayment: {
    success: (amount = 0.01, resource = 'https://example.com/resource') => ({
      payment_id: `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      payment_header: `header_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      challenge: `challenge-${Date.now()}`,
      amount,
      resource,
      timestamp: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      facilitator_url: 'https://api.sangria.network'
    }),

    validation_error: (message = 'Invalid request') => ({
      error: message,
      error_code: 'VALIDATION_ERROR',
      status: 400
    }),

    rate_limited: () => ({
      error: 'Rate limit exceeded',
      error_code: 'RATE_LIMITED',
      retry_after: 60,
      status: 429
    }),

    server_error: () => ({
      error: 'Internal server error',
      error_code: 'SERVER_ERROR',
      status: 500
    })
  },

  // Payment settlement responses
  settlePayment: {
    success: (amount = 0.01, transaction = null) => ({
      success: true,
      transaction: transaction || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      amount,
      timestamp: Math.floor(Date.now() / 1000),
      confirmation_url: `https://etherscan.io/tx/tx-${Date.now()}`,
      gas_fee: 0.001,
      network: 'base-mainnet'
    }),

    invalid_signature: () => ({
      success: false,
      error_message: 'Invalid payment signature',
      error_reason: 'INVALID_SIGNATURE',
      status: 402
    }),

    insufficient_funds: () => ({
      success: false,
      error_message: 'Insufficient funds',
      error_reason: 'INSUFFICIENT_FUNDS',
      status: 402,
      required_amount: 0.01,
      available_amount: 0.005
    }),

    expired_payment: () => ({
      success: false,
      error_message: 'Payment has expired',
      error_reason: 'PAYMENT_EXPIRED',
      status: 402,
      expires_at: Math.floor(Date.now() / 1000) - 300 // 5 minutes ago
    }),

    network_error: () => ({
      success: false,
      error_message: 'Network congestion, please retry',
      error_reason: 'NETWORK_CONGESTION',
      status: 503,
      retry_after: 30
    })
  },

  // Status responses
  status: {
    unhealthy: () => ({
      status: 'unhealthy',
      errors: ['Database connection failed', 'Redis unavailable'],
      timestamp: Math.floor(Date.now() / 1000)
    })
  }
}

/**
 * Response delay simulation for testing timeout handling
 */
export const responseDelays = {
  fast: 50,      // 50ms - normal response
  slow: 2000,    // 2s - slow response
  timeout: 10000 // 10s - timeout scenario
}

/**
 * Network condition simulation
 */
export const networkConditions = {
  stable: {
    success_rate: 1.0,
    avg_latency: 100
  },
  unstable: {
    success_rate: 0.7,
    avg_latency: 500
  },
  poor: {
    success_rate: 0.3,
    avg_latency: 2000
  }
}