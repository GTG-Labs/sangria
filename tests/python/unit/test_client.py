"""Unit tests for Sangria Python SDK client."""

import base64
import json
from unittest.mock import AsyncMock, patch

import pytest
from sangria_sdk.client import SangriaMerchantClient
from sangria_sdk.models import FixedPriceOptions, PaymentProceeded, PaymentResponse


class TestSangriaMerchantClient:
    """Test SangriaMerchantClient."""

    def test_init_default_endpoints(self):
        """Test client initialization with default endpoints."""
        client = SangriaMerchantClient(
            base_url="https://api.sangria.net",
            api_key="test_key_123"
        )
        assert client.generate_endpoint == "/v1/generate-payment"
        assert client.settle_endpoint == "/v1/settle-payment"

    def test_init_custom_endpoints(self):
        """Test client initialization with custom endpoints."""
        client = SangriaMerchantClient(
            base_url="https://api.sangria.net",
            api_key="test_key_123",
            generate_endpoint="/custom/generate",
            settle_endpoint="/custom/settle",
            timeout_seconds=15.0
        )
        assert client.generate_endpoint == "/custom/generate"
        assert client.settle_endpoint == "/custom/settle"

    @pytest.mark.asyncio
    async def test_handle_fixed_price_no_payment_header(self):
        """Test handle_fixed_price without payment header (generate payment)."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(
            price=10.00,
            resource="/premium",
            description="Premium content"
        )

        mock_x402_response = {
            "payment_id": "pay_123",
            "amount": 10.00,
            "currency": "USD",
            "payment_url": "https://pay.sangria.net/pay_123"
        }

        with patch.object(client._http, 'post_json', return_value=mock_x402_response) as mock_post:
            result = await client.handle_fixed_price(None, options)

            mock_post.assert_called_once_with(
                "/v1/generate-payment",
                {"amount": 10.00, "resource": "/premium", "description": "Premium content"}
            )

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body == mock_x402_response

            expected_encoded = base64.b64encode(json.dumps(mock_x402_response).encode()).decode()
            assert result.headers["PAYMENT-REQUIRED"] == expected_encoded

    @pytest.mark.asyncio
    async def test_handle_fixed_price_with_payment_header_success(self):
        """Test handle_fixed_price with payment header (successful settlement)."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(price=5.99, resource="/api/data")

        mock_settle_response = {
            "success": True,
            "transaction": "tx_abc123",
            "amount": 5.99
        }

        with patch.object(client._http, 'post_json', return_value=mock_settle_response) as mock_post:
            result = await client.handle_fixed_price("payment_signature_xyz", options)

            mock_post.assert_called_once_with(
                "/v1/settle-payment",
                {"payment_payload": "payment_signature_xyz"}
            )

            assert isinstance(result, PaymentProceeded)
            assert result.paid is True
            assert result.amount == 5.99
            assert result.transaction == "tx_abc123"

    @pytest.mark.asyncio
    async def test_handle_fixed_price_with_payment_header_failure(self):
        """Test handle_fixed_price with payment header (failed settlement)."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(price=15.00, resource="/premium")

        mock_settle_response = {
            "success": False,
            "error_message": "Insufficient funds",
            "error_reason": "insufficient_balance"
        }

        with patch.object(client._http, 'post_json', return_value=mock_settle_response) as mock_post:
            result = await client.handle_fixed_price("invalid_signature", options)

            mock_post.assert_called_once_with(
                "/v1/settle-payment",
                {"payment_payload": "invalid_signature"}
            )

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body == {
                "error": "Insufficient funds",
                "error_reason": "insufficient_balance"
            }

    @pytest.mark.asyncio
    async def test_handle_fixed_price_settle_missing_error_message(self):
        """Test settlement with missing error message uses default."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(price=20.00, resource="/test")

        mock_settle_response = {
            "success": False,
            "error_reason": "timeout"
        }

        with patch.object(client._http, 'post_json', return_value=mock_settle_response):
            result = await client.handle_fixed_price("test_signature", options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body == {
                "error": "Payment failed",
                "error_reason": "timeout"
            }

    @pytest.mark.asyncio
    async def test_generate_payment_exception(self):
        """Test _generate_payment handles exceptions gracefully."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(price=8.00, resource="/test")

        with patch.object(client._http, 'post_json', side_effect=Exception("Network error")):
            result = await client.handle_fixed_price(None, options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 500
            assert result.body == {"error": "Payment service unavailable"}

    @pytest.mark.asyncio
    async def test_settle_payment_exception(self):
        """Test _settle_payment handles exceptions gracefully."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(price=12.00, resource="/test")

        with patch.object(client._http, 'post_json', side_effect=Exception("API error")):
            result = await client.handle_fixed_price("test_signature", options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 500
            assert result.body == {"error": "Payment settlement failed"}

    @pytest.mark.asyncio
    async def test_settle_payment_success_missing_transaction(self):
        """Test successful settlement without transaction field."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(price=7.50, resource="/test")

        mock_settle_response = {"success": True}

        with patch.object(client._http, 'post_json', return_value=mock_settle_response):
            result = await client.handle_fixed_price("test_signature", options)

            assert isinstance(result, PaymentProceeded)
            assert result.paid is True
            assert result.amount == 7.50
            assert result.transaction is None

    @pytest.mark.asyncio
    async def test_aclose(self):
        """Test client close method."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        with patch.object(client._http, 'close') as mock_close:
            await client.aclose()
            mock_close.assert_called_once()

    @pytest.mark.asyncio
    async def test_empty_payment_header_treated_as_none(self):
        """Test that empty string payment header is treated like None."""
        client = SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test_key"
        )

        options = FixedPriceOptions(price=5.00, resource="/test")

        mock_x402_response = {"payment_id": "pay_123"}

        with patch.object(client._http, 'post_json', return_value=mock_x402_response) as mock_post:
            result = await client.handle_fixed_price("", options)

            mock_post.assert_called_once_with(
                "/v1/generate-payment",
                {"amount": 5.00, "resource": "/test"}
            )

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402