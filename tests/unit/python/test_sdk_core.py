"""
Python SDK Core Tests
Tests SangriaMerchantClient with comprehensive input/output validation
"""

import asyncio
import base64
import json
import math
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

from sangria_sdk.client import SangriaMerchantClient
from sangria_sdk.models import FixedPriceOptions, PaymentResponse, PaymentProceeded

pytestmark = pytest.mark.asyncio


class TestSangriaMerchantClient:

    @pytest.fixture
    def client(self):
        """Create test client instance"""
        return SangriaMerchantClient(
            base_url="https://api.test.com",
            api_key="test-key-123",
            timeout_seconds=5.0
        )

    @pytest.fixture
    def valid_options(self):
        """Valid payment options for testing"""
        return FixedPriceOptions(
            price=0.01,
            resource="/api/premium",
            description="Test payment"
        )

    async def test_initialization_with_custom_config(self):
        """Test client initialization with custom configuration"""
        client = SangriaMerchantClient(
            base_url="https://custom.api.com",
            api_key="custom-key",
            generate_endpoint="/custom/generate",
            settle_endpoint="/custom/settle",
            timeout_seconds=10.0
        )

        # Check internal httpx client configuration
        assert str(client._http._client.base_url) == "https://custom.api.com"
        assert client._http._client.headers["Authorization"] == "Bearer custom-key"
        assert client._http._client.timeout.read == 10.0  # httpx returns Timeout object
        assert client.generate_endpoint == "/custom/generate"
        assert client.settle_endpoint == "/custom/settle"

        await client.aclose()

    async def test_payment_generation_without_header(self, client, valid_options):
        """Test payment generation when no payment header provided"""
        mock_response = {
            "payment_id": "payment_123",
            "challenge": "challenge_456",
            "amount": 0.01,
            "resource": "/api/premium"
        }

        with patch.object(client._http, 'post_json', return_value=mock_response):
            result = await client.handle_fixed_price(None, valid_options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body == mock_response

            # Verify PAYMENT-REQUIRED header is base64 encoded
            assert "PAYMENT-REQUIRED" in result.headers
            encoded_payload = result.headers["PAYMENT-REQUIRED"]
            decoded_payload = json.loads(base64.b64decode(encoded_payload).decode())
            assert decoded_payload == mock_response

        await client.aclose()

    async def test_payment_generation_empty_string_header(self, client, valid_options):
        """Test payment generation with empty string header (treated as None)"""
        mock_response = {"payment_id": "test"}

        with patch.object(client._http, 'post_json', return_value=mock_response):
            result = await client.handle_fixed_price("", valid_options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402

        await client.aclose()

    async def test_payment_settlement_success(self, client, valid_options):
        """Test successful payment settlement"""
        payment_header = "valid_payment_signature"
        mock_response = {
            "success": True,
            "transaction": "tx_abc123"
        }

        with patch.object(client._http, 'post_json', return_value=mock_response):
            result = await client.handle_fixed_price(payment_header, valid_options)

            assert isinstance(result, PaymentProceeded)
            assert result.paid is True
            assert result.amount == 0.01
            assert result.transaction == "tx_abc123"

            # Verify settlement endpoint was called with correct payload
            client._http.post_json.assert_called_once_with(
                "/v1/settle-payment",
                {"payment_payload": payment_header}
            )

        await client.aclose()

    async def test_payment_settlement_missing_transaction(self, client, valid_options):
        """Test settlement success without transaction field"""
        mock_response = {"success": True}  # Missing transaction

        with patch.object(client._http, 'post_json', return_value=mock_response):
            result = await client.handle_fixed_price("test_header", valid_options)

            assert isinstance(result, PaymentProceeded)
            assert result.transaction is None

        await client.aclose()

    async def test_payment_settlement_failure_with_message(self, client, valid_options):
        """Test payment settlement failure with error message"""
        mock_response = {
            "success": False,
            "error_reason": "INSUFFICIENT_FUNDS",
            "error_message": "Insufficient balance for payment"
        }

        with patch.object(client._http, 'post_json', return_value=mock_response):
            result = await client.handle_fixed_price("invalid_header", valid_options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body["error"] == "Insufficient balance for payment"
            assert result.body["error_reason"] == "INSUFFICIENT_FUNDS"

        await client.aclose()

    async def test_payment_settlement_failure_without_message(self, client, valid_options):
        """Test payment settlement failure without specific error message"""
        mock_response = {
            "success": False,
            "error_reason": "INVALID_SIGNATURE"
        }

        with patch.object(client._http, 'post_json', return_value=mock_response):
            result = await client.handle_fixed_price("bad_signature", valid_options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 402
            assert result.body["error"] == "Payment failed"
            assert result.body["error_reason"] == "INVALID_SIGNATURE"

        await client.aclose()

    async def test_generation_network_error(self, client, valid_options):
        """Test payment generation with network error"""
        with patch.object(client._http, 'post_json', side_effect=Exception("Network error")):
            result = await client.handle_fixed_price(None, valid_options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 500
            assert result.body == {"error": "Payment service unavailable"}

        await client.aclose()

    async def test_settlement_network_error(self, client, valid_options):
        """Test payment settlement with network error"""
        with patch.object(client._http, 'post_json', side_effect=Exception("Connection timeout")):
            result = await client.handle_fixed_price("test_header", valid_options)

            assert isinstance(result, PaymentResponse)
            assert result.status_code == 500
            assert result.body == {"error": "Payment settlement failed"}

        await client.aclose()

    async def test_price_validation_edge_cases(self, client):
        """Test comprehensive price validation in FixedPriceOptions"""

        # Valid prices should work
        valid_prices = [0.000001, 0.01, 1.0, 999999.99]
        for price in valid_prices:
            options = FixedPriceOptions(price=price, resource="/test")
            assert options.price == price

        # Invalid prices should raise ValueError
        invalid_prices = [
            0,           # Zero
            -0.01,       # Negative
            float('inf'), # Infinity
            float('-inf'), # Negative infinity
            float('nan'), # NaN
        ]

        for price in invalid_prices:
            with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
                FixedPriceOptions(price=price, resource="/test")

        await client.aclose()

    async def test_options_serialization(self, client):
        """Test FixedPriceOptions serialization for API calls"""
        # With description
        options = FixedPriceOptions(
            price=1.50,
            resource="/api/premium",
            description="Premium content access"
        )
        serialized = options.to_generate_dict()

        assert serialized == {
            "amount": 1.50,
            "resource": "/api/premium",
            "description": "Premium content access"
        }

        # Without description
        options_no_desc = FixedPriceOptions(price=0.01, resource="/api/basic")
        serialized_no_desc = options_no_desc.to_generate_dict()

        assert serialized_no_desc == {
            "amount": 0.01,
            "resource": "/api/basic"
        }
        assert "description" not in serialized_no_desc

        await client.aclose()

    async def test_concurrent_requests(self, client, valid_options):
        """Test client handles concurrent requests correctly"""
        mock_responses = [
            {"payment_id": f"payment_{i}", "challenge": f"challenge_{i}"}
            for i in range(5)
        ]

        with patch.object(client._http, 'post_json') as mock_post:
            mock_post.side_effect = mock_responses

            # Make 5 concurrent requests
            tasks = [
                client.handle_fixed_price(None, valid_options)
                for _ in range(5)
            ]
            results = await asyncio.gather(*tasks)

            # All should be PaymentResponse with 402
            for result in results:
                assert isinstance(result, PaymentResponse)
                assert result.status_code == 402

            # Should have made 5 separate API calls
            assert mock_post.call_count == 5

        await client.aclose()

    async def test_base64_encoding_correctness(self, client, valid_options):
        """Test base64 encoding/decoding of payment payload"""
        mock_response = {
            "payment_id": "test_payment",
            "special_chars": "àáâãäåæçèéêë",  # Unicode characters
            "nested": {"data": [1, 2, 3]}
        }

        with patch.object(client._http, 'post_json', return_value=mock_response):
            result = await client.handle_fixed_price(None, valid_options)

            # Decode and verify the encoded payload
            encoded = result.headers["PAYMENT-REQUIRED"]
            decoded_bytes = base64.b64decode(encoded)
            decoded_payload = json.loads(decoded_bytes.decode('utf-8'))

            assert decoded_payload == mock_response
            assert decoded_payload["special_chars"] == "àáâãäåæçèéêë"
            assert decoded_payload["nested"]["data"] == [1, 2, 3]

        await client.aclose()

    async def test_resource_url_handling(self, client):
        """Test different resource URL formats"""
        test_cases = [
            "/api/premium",
            "/api/premium?param=value",
            "/api/path/with/segments",
            "https://external.com/api/resource",
            "/api/unicode-café",
        ]

        mock_response = {"payment_id": "test"}

        with patch.object(client._http, 'post_json', return_value=mock_response) as mock_post:
            for resource_url in test_cases:
                options = FixedPriceOptions(price=0.01, resource=resource_url)
                await client.handle_fixed_price(None, options)

                # Verify the resource was passed correctly in the API call
                call_args = mock_post.call_args[0][1]  # Second argument to post_json
                assert call_args["resource"] == resource_url

        await client.aclose()

    async def test_client_cleanup(self, client):
        """Test proper client cleanup"""
        with patch.object(client._http, 'close') as mock_close:
            await client.aclose()
            mock_close.assert_called_once()

    async def test_payment_type_discriminated_union(self, client, valid_options):
        """Test PaymentResult type discrimination works correctly"""
        # Test PaymentResponse path
        with patch.object(client._http, 'post_json', return_value={"test": "data"}):
            result = await client.handle_fixed_price(None, valid_options)
            assert isinstance(result, PaymentResponse)
            assert hasattr(result, 'status_code')
            assert hasattr(result, 'body')
            assert hasattr(result, 'headers')

        # Test PaymentProceeded path
        with patch.object(client._http, 'post_json', return_value={"success": True}):
            result = await client.handle_fixed_price("test_header", valid_options)
            assert isinstance(result, PaymentProceeded)
            assert hasattr(result, 'paid')
            assert hasattr(result, 'amount')
            assert hasattr(result, 'transaction')

        await client.aclose()