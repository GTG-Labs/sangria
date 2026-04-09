"""Tests for sangria_sdk.client module."""

import base64
import json
from unittest.mock import AsyncMock, Mock, patch

import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'sdk', 'python', 'src'))

from sangria_sdk.client import SangriaMerchantClient
from sangria_sdk.models import (
    FixedPriceOptions,
    PaymentProceeded,
    PaymentResponse,
)


class TestSangriaMerchantClient:
    """Test SangriaMerchantClient class."""

    def test_initialization_default_params(self):
        """Test client initialization with default parameters."""
        client = SangriaMerchantClient(
            base_url="https://api.sangria.net",
            api_key="sk_test_123"
        )
        assert client.generate_endpoint == "/v1/generate-payment"
        assert client.settle_endpoint == "/v1/settle-payment"

    def test_initialization_custom_params(self):
        """Test client initialization with custom parameters."""
        client = SangriaMerchantClient(
            base_url="https://api.example.com",
            api_key="sk_live_456",
            generate_endpoint="/api/generate",
            settle_endpoint="/api/settle",
            timeout_seconds=15.0
        )
        assert client.generate_endpoint == "/api/generate"
        assert client.settle_endpoint == "/api/settle"

    @pytest.mark.asyncio
    async def test_handle_fixed_price_without_payment_header(self):
        """Test handle_fixed_price without payment header (generate payment)."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(
            price=10.0,
            resource="/api/premium",
            description="Test payment"
        )

        # Mock the _generate_payment method
        expected_response = PaymentResponse(
            status_code=402,
            body={"payment_id": "pay_123", "amount": 10.0}
        )

        with patch.object(client, '_generate_payment', new_callable=AsyncMock) as mock_generate:
            mock_generate.return_value = expected_response

            result = await client.handle_fixed_price(None, options)

            assert result == expected_response
            mock_generate.assert_called_once_with(options)

    @pytest.mark.asyncio
    async def test_handle_fixed_price_with_payment_header(self):
        """Test handle_fixed_price with payment header (settle payment)."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(
            price=10.0,
            resource="/api/premium"
        )
        payment_header = "payment_header_123"

        # Mock the _settle_payment method
        expected_response = PaymentProceeded(
            paid=True,
            amount=10.0,
            transaction="tx_456"
        )

        with patch.object(client, '_settle_payment', new_callable=AsyncMock) as mock_settle:
            mock_settle.return_value = expected_response

            result = await client.handle_fixed_price(payment_header, options)

            assert result == expected_response
            mock_settle.assert_called_once_with(payment_header, options)

    @pytest.mark.asyncio
    async def test_generate_payment_success(self):
        """Test _generate_payment with successful response."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(
            price=25.50,
            resource="/api/content",
            description="Premium content"
        )

        # Mock the HTTP client
        mock_response = {
            "payment_id": "pay_abc123",
            "amount": 25.50,
            "resource": "/api/content"
        }

        with patch.object(client._http, 'post_json', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await client._generate_payment(options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body == mock_response

            # Verify the PAYMENT-REQUIRED header is properly encoded
            expected_encoded = base64.b64encode(
                json.dumps(mock_response).encode()
            ).decode()
            assert result.headers["PAYMENT-REQUIRED"] == expected_encoded

            # Verify HTTP call
            mock_post.assert_called_once_with(
                "/v1/generate-payment",
                options.to_generate_dict()
            )

    @pytest.mark.asyncio
    async def test_generate_payment_error(self):
        """Test _generate_payment with HTTP error."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(price=10.0, resource="/api/test")

        # Mock HTTP client to raise exception
        with patch.object(client._http, 'post_json', new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = Exception("Network error")

            result = await client._generate_payment(options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 500
            assert result.body == {"error": "Payment service unavailable"}
            assert result.headers == {}

    @pytest.mark.asyncio
    async def test_settle_payment_success(self):
        """Test _settle_payment with successful response."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(price=15.0, resource="/api/premium")
        payment_header = "payment_abc123"

        # Mock successful settlement response
        mock_response = {
            "success": True,
            "transaction": "tx_def456",
            "amount": 15.0
        }

        with patch.object(client._http, 'post_json', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await client._settle_payment(payment_header, options)

            assert isinstance(result, PaymentProceeded)
            assert result.paid is True
            assert result.amount == 15.0
            assert result.transaction == "tx_def456"

            # Verify HTTP call
            mock_post.assert_called_once_with(
                "/v1/settle-payment",
                {"payment_payload": payment_header}
            )

    @pytest.mark.asyncio
    async def test_settle_payment_failure_with_error_message(self):
        """Test _settle_payment with failed payment and error message."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(price=10.0, resource="/api/test")
        payment_header = "invalid_payment"

        # Mock failed settlement response
        mock_response = {
            "success": False,
            "error_message": "Insufficient funds",
            "error_reason": "INSUFFICIENT_BALANCE"
        }

        with patch.object(client._http, 'post_json', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await client._settle_payment(payment_header, options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body["error"] == "Insufficient funds"
            assert result.body["error_reason"] == "INSUFFICIENT_BALANCE"

    @pytest.mark.asyncio
    async def test_settle_payment_failure_without_error_message(self):
        """Test _settle_payment with failed payment but no error message."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(price=10.0, resource="/api/test")
        payment_header = "invalid_payment"

        # Mock failed settlement response without error message
        mock_response = {
            "success": False
        }

        with patch.object(client._http, 'post_json', new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            result = await client._settle_payment(payment_header, options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body["error"] == "Payment failed"
            assert "error_reason" in result.body

    @pytest.mark.asyncio
    async def test_settle_payment_exception(self):
        """Test _settle_payment with HTTP exception."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(price=10.0, resource="/api/test")
        payment_header = "payment_123"

        # Mock HTTP client to raise exception
        with patch.object(client._http, 'post_json', new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = Exception("Connection timeout")

            result = await client._settle_payment(payment_header, options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 500
            assert result.body == {"error": "Payment settlement failed"}

    @pytest.mark.asyncio
    async def test_aclose(self):
        """Test aclose method."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        with patch.object(client._http, 'close', new_callable=AsyncMock) as mock_close:
            await client.aclose()
            mock_close.assert_called_once()

    @pytest.mark.asyncio
    async def test_context_manager_usage(self):
        """Test that client can be used as async context manager."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="sk_test_123"
        )

        options = FixedPriceOptions(price=5.0, resource="/api/test")

        # Mock HTTP methods
        with patch.object(client._http, 'close', new_callable=AsyncMock) as mock_close, \
             patch.object(client, '_generate_payment', new_callable=AsyncMock) as mock_generate:

            mock_generate.return_value = PaymentResponse(
                status_code=402,
                body={"test": True}
            )

            # Test that we can use the client and then close it
            result = await client.handle_fixed_price(None, options)
            await client.aclose()

            assert isinstance(result, PaymentResponse)
            mock_close.assert_called_once()