"""Integration tests for Sangria Python SDK API contract."""

import base64
import json

import pytest
import respx
import httpx
from sangria_sdk import SangriaMerchantClient
from sangria_sdk.models import FixedPriceOptions, PaymentResponse, PaymentProceeded

from conftest import assert_request_headers, assert_request_payload


@pytest.mark.asyncio
class TestGeneratePaymentAPI:
    """Test payment generation API contract."""

    async def test_generate_payment_success(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url,
        test_api_key,
        mock_generate_payment_success
    ):
        """Test successful payment generation API call."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/generate-payment"
        ).mock(return_value=httpx.Response(200, json=mock_generate_payment_success))

        options = FixedPriceOptions(
            price=10.00,
            resource="/premium/article/123",
            description="Premium article access"
        )

        result = await sangria_client.handle_fixed_price(None, options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 402
        assert result.body == mock_generate_payment_success

        expected_encoded = base64.b64encode(
            json.dumps(mock_generate_payment_success).encode()
        ).decode()
        assert result.headers["PAYMENT-REQUIRED"] == expected_encoded

        request = setup_respx_mock.calls[0].request
        assert_request_headers(request, test_api_key)
        assert_request_payload(request, {
            "amount": 10.00,
            "resource": "/premium/article/123",
            "description": "Premium article access"
        })

    async def test_generate_payment_without_description(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url,
        test_api_key,
        mock_generate_payment_success
    ):
        """Test payment generation without description."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/generate-payment"
        ).mock(return_value=httpx.Response(200, json=mock_generate_payment_success))

        options = FixedPriceOptions(
            price=5.99,
            resource="/api/data"
        )

        result = await sangria_client.handle_fixed_price(None, options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 402

        request = setup_respx_mock.calls[0].request
        assert_request_headers(request, test_api_key)
        assert_request_payload(request, {
            "amount": 5.99,
            "resource": "/api/data"
        })

    async def test_generate_payment_server_error(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url
    ):
        """Test payment generation with server error."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/generate-payment"
        ).mock(return_value=httpx.Response(500, text="Internal Server Error"))

        options = FixedPriceOptions(price=15.00, resource="/test")

        result = await sangria_client.handle_fixed_price(None, options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 500
        assert result.body == {"error": "Payment service unavailable"}

    async def test_generate_payment_network_error(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url
    ):
        """Test payment generation with network error."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/generate-payment"
        ).mock(side_effect=httpx.ConnectError("Connection failed"))

        options = FixedPriceOptions(price=20.00, resource="/test")

        result = await sangria_client.handle_fixed_price(None, options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 500
        assert result.body == {"error": "Payment service unavailable"}


@pytest.mark.asyncio
class TestSettlePaymentAPI:
    """Test payment settlement API contract."""

    async def test_settle_payment_success(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url,
        test_api_key,
        mock_settle_payment_success
    ):
        """Test successful payment settlement API call."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/settle-payment"
        ).mock(return_value=httpx.Response(200, json=mock_settle_payment_success))

        options = FixedPriceOptions(price=10.00, resource="/premium")
        payment_signature = "payment_sig_abc123xyz"

        result = await sangria_client.handle_fixed_price(payment_signature, options)

        assert isinstance(result, PaymentProceeded)
        assert result.paid is True
        assert result.amount == 10.00
        assert result.transaction == "tx_settlement_abc123"

        request = setup_respx_mock.calls[0].request
        assert_request_headers(request, test_api_key)
        assert_request_payload(request, {
            "payment_payload": payment_signature
        })

    async def test_settle_payment_failure(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url,
        test_api_key,
        mock_settle_payment_failure
    ):
        """Test failed payment settlement API call."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/settle-payment"
        ).mock(return_value=httpx.Response(200, json=mock_settle_payment_failure))

        options = FixedPriceOptions(price=25.00, resource="/premium")
        invalid_signature = "invalid_payment_signature"

        result = await sangria_client.handle_fixed_price(invalid_signature, options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 402
        assert result.body == {
            "error": "Payment verification failed",
            "error_reason": "invalid_signature"
        }

        request = setup_respx_mock.calls[0].request
        assert_request_headers(request, test_api_key)
        assert_request_payload(request, {
            "payment_payload": invalid_signature
        })

    async def test_settle_payment_client_error_4xx(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url
    ):
        """Test settlement with 4xx client error returns response data."""
        error_response = {
            "error": "Invalid payment payload",
            "error_code": "INVALID_PAYLOAD",
            "details": "Signature verification failed"
        }

        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/settle-payment"
        ).mock(return_value=httpx.Response(400, json=error_response))

        options = FixedPriceOptions(price=15.00, resource="/test")
        malformed_signature = "malformed_signature"

        result = await sangria_client.handle_fixed_price(malformed_signature, options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 402
        assert result.body == {"error": "Payment failed", "error_reason": None}

    async def test_settle_payment_server_error_5xx(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url
    ):
        """Test settlement with 5xx server error."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/settle-payment"
        ).mock(return_value=httpx.Response(503, text="Service Unavailable"))

        options = FixedPriceOptions(price=30.00, resource="/test")

        result = await sangria_client.handle_fixed_price("test_sig", options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 500
        assert result.body == {"error": "Payment settlement failed"}

    async def test_settle_payment_network_timeout(
        self,
        sangria_client,
        setup_respx_mock,
        mock_api_base_url
    ):
        """Test settlement with network timeout."""
        setup_respx_mock.post(
            f"{mock_api_base_url}/v1/settle-payment"
        ).mock(side_effect=httpx.TimeoutException("Request timeout"))

        options = FixedPriceOptions(price=12.50, resource="/test")

        result = await sangria_client.handle_fixed_price("test_sig", options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 500
        assert result.body == {"error": "Payment settlement failed"}


@pytest.mark.asyncio
class TestCustomEndpoints:
    """Test custom endpoint configuration."""

    async def test_custom_generate_endpoint(
        self,
        setup_respx_mock,
        mock_api_base_url,
        test_api_key,
        mock_generate_payment_success
    ):
        """Test payment generation with custom endpoint."""
        custom_client = SangriaMerchantClient(
            base_url=mock_api_base_url,
            api_key=test_api_key,
            generate_endpoint="/custom/payment/generate",
            settle_endpoint="/custom/payment/settle"
        )

        setup_respx_mock.post(
            f"{mock_api_base_url}/custom/payment/generate"
        ).mock(return_value=httpx.Response(200, json=mock_generate_payment_success))

        options = FixedPriceOptions(price=8.00, resource="/test")

        result = await custom_client.handle_fixed_price(None, options)

        assert isinstance(result, PaymentResponse)
        assert result.status_code == 402

        await custom_client.aclose()

    async def test_custom_settle_endpoint(
        self,
        setup_respx_mock,
        mock_api_base_url,
        test_api_key,
        mock_settle_payment_success
    ):
        """Test payment settlement with custom endpoint."""
        custom_client = SangriaMerchantClient(
            base_url=mock_api_base_url,
            api_key=test_api_key,
            generate_endpoint="/custom/payment/generate",
            settle_endpoint="/custom/payment/settle"
        )

        setup_respx_mock.post(
            f"{mock_api_base_url}/custom/payment/settle"
        ).mock(return_value=httpx.Response(200, json=mock_settle_payment_success))

        options = FixedPriceOptions(price=18.00, resource="/premium")

        result = await custom_client.handle_fixed_price("test_signature", options)

        assert isinstance(result, PaymentProceeded)
        assert result.paid is True
        assert result.amount == 18.00

        await custom_client.aclose()