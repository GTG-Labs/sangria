"""Test fixtures for Python SDK tests."""

from typing import Any, Dict

# Mock API responses
MOCK_GENERATE_PAYMENT_SUCCESS = {
    "payment_id": "pay_python_test_123",
    "amount": 10.00,
    "currency": "USD",
    "payment_url": "https://pay.sangria.net/pay_python_test_123",
    "expires_at": "2024-01-01T13:00:00Z",
    "challenge": "mock_challenge_data_python"
}

MOCK_SETTLE_PAYMENT_SUCCESS = {
    "success": True,
    "transaction": "tx_python_settlement_abc123",
    "amount": 10.00,
    "timestamp": "2024-01-01T12:30:00Z"
}

MOCK_SETTLE_PAYMENT_FAILURE = {
    "success": False,
    "error_message": "Payment signature verification failed",
    "error_reason": "invalid_signature"
}

MOCK_SETTLE_PAYMENT_FAILURE_NO_MESSAGE = {
    "success": False,
    "error_reason": "timeout"
}

# Mock error responses
MOCK_API_ERROR_RESPONSES = {
    "unauthorized": {
        "status": 401,
        "body": {"error": "Unauthorized", "message": "Invalid API key"}
    },
    "bad_request": {
        "status": 400,
        "body": {"error": "Bad Request", "message": "Invalid request payload"}
    },
    "internal_error": {
        "status": 500,
        "body": {"error": "Internal Server Error", "message": "Service temporarily unavailable"}
    },
    "service_unavailable": {
        "status": 503,
        "body": {"error": "Service Unavailable", "message": "Payment service is down"}
    }
}

def create_mock_generate_response(amount: float, **kwargs: Any) -> Dict[str, Any]:
    """Create a mock generate payment response with custom amount."""
    response = MOCK_GENERATE_PAYMENT_SUCCESS.copy()
    response["amount"] = amount
    response.update(kwargs)
    return response

def create_mock_settle_response(success: bool, **kwargs: Any) -> Dict[str, Any]:
    """Create a mock settle payment response."""
    if success:
        response = MOCK_SETTLE_PAYMENT_SUCCESS.copy()
    else:
        response = MOCK_SETTLE_PAYMENT_FAILURE.copy()
    response.update(kwargs)
    return response

def create_mock_x402_challenge(payment_id: str, amount: float, **kwargs: Any) -> Dict[str, Any]:
    """Create a mock X402 challenge payload."""
    challenge = {
        "payment_id": payment_id,
        "amount": amount,
        "currency": "USD",
        "payment_url": f"https://pay.sangria.net/{payment_id}",
        "expires_at": "2024-01-01T13:00:00Z"
    }
    challenge.update(kwargs)
    return challenge