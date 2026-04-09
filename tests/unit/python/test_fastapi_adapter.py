"""Tests for sangria_sdk.adapters.fastapi module."""

from unittest.mock import AsyncMock, Mock
import sys
import os

import pytest
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

# Add the SDK path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'sdk', 'python', 'src'))

from sangria_sdk.adapters.fastapi import require_sangria_payment
from sangria_sdk.client import SangriaMerchantClient
from sangria_sdk.models import FixedPriceOptions, PaymentProceeded, PaymentResponse


class TestRequireSangriaPayment:
    """Test require_sangria_payment decorator."""

    def test_decorator_amount_validation(self):
        """Test that decorator validates amount during creation."""
        mock_client = Mock(spec=SangriaMerchantClient)

        # Valid amounts should not raise
        require_sangria_payment(mock_client, amount=10.0)
        require_sangria_payment(mock_client, amount=0.01)
        require_sangria_payment(mock_client, amount=1)

        # Invalid amounts should raise ValueError
        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            require_sangria_payment(mock_client, amount=0)

        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            require_sangria_payment(mock_client, amount=-1.0)

        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            require_sangria_payment(mock_client, amount=float('inf'))

        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            require_sangria_payment(mock_client, amount=float('nan'))

    @pytest.mark.asyncio
    async def test_decorated_function_without_payment_header(self):
        """Test decorated function without payment header (should return 402)."""
        mock_client = Mock(spec=SangriaMerchantClient)
        mock_client.handle_fixed_price = AsyncMock()

        # Mock payment response (402)
        payment_response = PaymentResponse(
            status_code=402,
            body={"payment_id": "pay_123", "amount": 10.0},
            headers={"PAYMENT-REQUIRED": "encoded_data"}
        )
        mock_client.handle_fixed_price.return_value = payment_response

        # Create decorator
        decorator = require_sangria_payment(mock_client, amount=10.0, description="Test payment")

        # Mock request
        mock_request = Mock(spec=Request)
        mock_request.headers.get.return_value = None  # No payment header
        mock_request.url = "https://api.test.com/premium"

        @decorator
        async def test_handler(request: Request):
            return {"content": "premium data"}

        result = await test_handler(mock_request)

        # Verify it's a JSON response with 402 status
        assert isinstance(result, JSONResponse)
        assert result.status_code == 402

        # Verify the client was called correctly
        mock_client.handle_fixed_price.assert_called_once()
        call_args = mock_client.handle_fixed_price.call_args
        assert call_args[1]["payment_header"] is None

        options = call_args[1]["options"]
        assert isinstance(options, FixedPriceOptions)
        assert options.price == 10.0
        assert options.resource == "https://api.test.com/premium"
        assert options.description == "Test payment"

    @pytest.mark.asyncio
    async def test_decorated_function_with_valid_payment(self):
        """Test decorated function with valid payment header (should proceed)."""
        mock_client = Mock(spec=SangriaMerchantClient)
        mock_client.handle_fixed_price = AsyncMock()

        # Mock successful payment
        payment_proceeded = PaymentProceeded(
            paid=True,
            amount=10.0,
            transaction="tx_abc123"
        )
        mock_client.handle_fixed_price.return_value = payment_proceeded

        # Create decorator
        decorator = require_sangria_payment(mock_client, amount=10.0)

        # Mock request with payment header
        mock_request = Mock(spec=Request)
        mock_request.headers.get.return_value = "valid_payment_signature"
        mock_request.url = "https://api.test.com/premium"
        mock_request.state = Mock()

        @decorator
        async def test_handler(request: Request):
            return {"content": "premium data"}

        result = await test_handler(mock_request)

        # Verify it returns the handler result
        assert result == {"content": "premium data"}

        # Verify payment info was stored in request state
        assert mock_request.state.sangria_payment == payment_proceeded

        # Verify client was called with payment header
        mock_client.handle_fixed_price.assert_called_once()
        call_args = mock_client.handle_fixed_price.call_args
        assert call_args[1]["payment_header"] == "valid_payment_signature"

    @pytest.mark.asyncio
    async def test_decorated_function_with_bypass(self):
        """Test decorated function with bypass condition."""
        mock_client = Mock(spec=SangriaMerchantClient)

        def bypass_condition(request: Request) -> bool:
            return request.headers.get("X-Admin") == "true"

        decorator = require_sangria_payment(
            mock_client,
            amount=10.0,
            bypass_if=bypass_condition
        )

        # Mock request that should bypass payment
        mock_request = Mock(spec=Request)
        mock_request.headers.get.side_effect = lambda key: {
            "X-Admin": "true",
            "PAYMENT-SIGNATURE": None
        }.get(key)

        @decorator
        async def test_handler(request: Request):
            return {"content": "admin access"}

        result = await test_handler(mock_request)

        # Should bypass payment check and call handler directly
        assert result == {"content": "admin access"}
        mock_client.handle_fixed_price.assert_not_called()

    @pytest.mark.asyncio
    async def test_decorated_function_no_bypass(self):
        """Test decorated function where bypass condition is false."""
        mock_client = Mock(spec=SangriaMerchantClient)
        mock_client.handle_fixed_price = AsyncMock()

        payment_response = PaymentResponse(
            status_code=402,
            body={"error": "Payment required"}
        )
        mock_client.handle_fixed_price.return_value = payment_response

        def bypass_condition(request: Request) -> bool:
            return request.headers.get("X-Admin") == "true"

        decorator = require_sangria_payment(
            mock_client,
            amount=5.0,
            bypass_if=bypass_condition
        )

        # Mock request that should NOT bypass payment
        mock_request = Mock(spec=Request)
        mock_request.headers.get.side_effect = lambda key: {
            "X-Admin": "false",
            "PAYMENT-SIGNATURE": None
        }.get(key)
        mock_request.url = "https://api.test.com/content"

        @decorator
        async def test_handler(request: Request):
            return {"content": "protected content"}

        result = await test_handler(mock_request)

        # Should require payment
        assert isinstance(result, JSONResponse)
        assert result.status_code == 402
        mock_client.handle_fixed_price.assert_called_once()

    @pytest.mark.asyncio
    async def test_request_as_positional_argument(self):
        """Test decorated function with request as positional argument."""
        mock_client = Mock(spec=SangriaMerchantClient)
        mock_client.handle_fixed_price = AsyncMock()

        payment_response = PaymentResponse(
            status_code=402,
            body={"test": True}
        )
        mock_client.handle_fixed_price.return_value = payment_response

        decorator = require_sangria_payment(mock_client, amount=15.0)

        # Mock request
        mock_request = Mock(spec=Request)
        mock_request.headers.get.return_value = None
        mock_request.url = "https://api.test.com/endpoint"

        @decorator
        async def test_handler(request: Request, other_param: str = "default"):
            return {"request_received": True, "param": other_param}

        # Call with request as positional argument
        result = await test_handler(mock_request, "custom_value")

        assert isinstance(result, JSONResponse)
        assert result.status_code == 402

    @pytest.mark.asyncio
    async def test_no_request_available_raises_error(self):
        """Test that missing request raises HTTPException."""
        mock_client = Mock(spec=SangriaMerchantClient)
        decorator = require_sangria_payment(mock_client, amount=10.0)

        @decorator
        async def test_handler(some_param: str):
            return {"data": some_param}

        with pytest.raises(HTTPException) as exc_info:
            await test_handler("test_value")

        assert exc_info.value.status_code == 500
        assert "FastAPI request not available" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_decorator_preserves_function_metadata(self):
        """Test that decorator preserves original function metadata."""
        mock_client = Mock(spec=SangriaMerchantClient)
        decorator = require_sangria_payment(mock_client, amount=1.0)

        @decorator
        async def original_function(request: Request):
            """Original function docstring."""
            return {"test": True}

        # Check that function metadata is preserved
        assert original_function.__name__ == "original_function"
        assert original_function.__doc__ == "Original function docstring."

    @pytest.mark.asyncio
    async def test_payment_header_name(self):
        """Test that correct payment header name is used."""
        mock_client = Mock(spec=SangriaMerchantClient)
        mock_client.handle_fixed_price = AsyncMock()

        payment_proceeded = PaymentProceeded(paid=True, amount=1.0)
        mock_client.handle_fixed_price.return_value = payment_proceeded

        decorator = require_sangria_payment(mock_client, amount=1.0)

        mock_request = Mock(spec=Request)
        mock_request.headers.get.return_value = "test_signature"
        mock_request.url = "https://api.test.com/"
        mock_request.state = Mock()

        @decorator
        async def test_handler(request: Request):
            return {"success": True}

        await test_handler(mock_request)

        # Verify the correct header name was requested
        mock_request.headers.get.assert_called_with("PAYMENT-SIGNATURE")

        # Verify the payment header was passed to client
        call_args = mock_client.handle_fixed_price.call_args
        assert call_args[1]["payment_header"] == "test_signature"