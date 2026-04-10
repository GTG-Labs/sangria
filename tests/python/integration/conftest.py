"""Pytest configuration and fixtures for Python SDK integration tests."""

from typing import Any, Dict

import pytest
import pytest_asyncio
import respx
import httpx
from sangria_sdk import SangriaMerchantClient


@pytest.fixture
def mock_api_base_url():
    """Base URL for mocked Sangria API."""
    return "https://api.sangria-test.net"


@pytest.fixture
def test_api_key():
    """Test API key for mocked requests."""
    return "test_api_key_12345"


@pytest_asyncio.fixture
async def sangria_client(mock_api_base_url, test_api_key):
    """Create a SangriaMerchantClient instance for testing."""
    client = SangriaMerchantClient(
        base_url=mock_api_base_url,
        api_key=test_api_key,
        timeout_seconds=5.0
    )
    yield client
    await client.aclose()


@pytest.fixture
def mock_generate_payment_success():
    """Mock successful payment generation response."""
    return {
        "payment_id": "pay_test_12345",
        "amount": 10.00,
        "currency": "USD",
        "payment_url": "https://pay.sangria.net/pay_test_12345",
        "expires_at": "2024-01-01T13:00:00Z",
        "challenge": "challenge_data_xyz"
    }


@pytest.fixture
def mock_settle_payment_success():
    """Mock successful payment settlement response."""
    return {
        "success": True,
        "transaction": "tx_settlement_abc123",
        "amount": 10.00,
        "timestamp": "2024-01-01T12:30:00Z"
    }


@pytest.fixture
def mock_settle_payment_failure():
    """Mock failed payment settlement response."""
    return {
        "success": False,
        "error_message": "Payment verification failed",
        "error_reason": "invalid_signature"
    }


@pytest.fixture
def setup_respx_mock():
    """Setup respx mock for HTTP requests."""
    with respx.mock() as mock:
        yield mock


def assert_request_headers(request: httpx.Request, expected_api_key: str) -> None:
    """Assert that the request has the correct headers."""
    assert request.headers["Authorization"] == f"Bearer {expected_api_key}"
    assert request.headers["Content-Type"] == "application/json"
    assert request.headers["Accept"] == "application/json"


def assert_request_payload(request: httpx.Request, expected_payload: Dict[str, Any]) -> None:
    """Assert that the request has the correct JSON payload."""
    import json
    actual_payload = json.loads(request.content)
    assert actual_payload == expected_payload