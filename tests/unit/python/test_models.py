"""Tests for sangria_sdk.models module."""

import math
import pytest

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', 'sdk', 'python', 'src'))

from sangria_sdk.models import (
    FixedPriceOptions,
    PaymentProceeded,
    PaymentResponse,
)


class TestFixedPriceOptions:
    """Test FixedPriceOptions model."""

    def test_valid_initialization(self):
        """Test valid FixedPriceOptions initialization."""
        options = FixedPriceOptions(
            price=10.50,
            resource="/api/premium",
            description="Premium content access"
        )
        assert options.price == 10.50
        assert options.resource == "/api/premium"
        assert options.description == "Premium content access"

    def test_initialization_without_description(self):
        """Test FixedPriceOptions initialization without description."""
        options = FixedPriceOptions(
            price=5.0,
            resource="/api/basic"
        )
        assert options.price == 5.0
        assert options.resource == "/api/basic"
        assert options.description is None

    def test_price_validation_zero(self):
        """Test that zero price raises ValueError."""
        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            FixedPriceOptions(price=0, resource="/api/test")

    def test_price_validation_negative(self):
        """Test that negative price raises ValueError."""
        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            FixedPriceOptions(price=-1.0, resource="/api/test")

    def test_price_validation_infinity(self):
        """Test that infinite price raises ValueError."""
        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            FixedPriceOptions(price=float('inf'), resource="/api/test")

    def test_price_validation_nan(self):
        """Test that NaN price raises ValueError."""
        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            FixedPriceOptions(price=float('nan'), resource="/api/test")

    def test_price_validation_non_numeric(self):
        """Test that non-numeric price raises ValueError."""
        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            FixedPriceOptions(price="10.50", resource="/api/test")  # type: ignore

    def test_to_generate_dict_with_description(self):
        """Test to_generate_dict method with description."""
        options = FixedPriceOptions(
            price=15.99,
            resource="/api/premium",
            description="Premium content"
        )
        result = options.to_generate_dict()
        expected = {
            "amount": 15.99,
            "resource": "/api/premium",
            "description": "Premium content"
        }
        assert result == expected

    def test_to_generate_dict_without_description(self):
        """Test to_generate_dict method without description."""
        options = FixedPriceOptions(
            price=5.0,
            resource="/api/basic"
        )
        result = options.to_generate_dict()
        expected = {
            "amount": 5.0,
            "resource": "/api/basic"
        }
        assert result == expected

    def test_integer_price(self):
        """Test that integer prices are accepted."""
        options = FixedPriceOptions(price=10, resource="/api/test")
        assert options.price == 10

    def test_very_small_price(self):
        """Test very small but positive prices."""
        options = FixedPriceOptions(price=0.01, resource="/api/test")
        assert options.price == 0.01

    def test_large_price(self):
        """Test large but finite prices."""
        options = FixedPriceOptions(price=999999.99, resource="/api/test")
        assert options.price == 999999.99


class TestPaymentResponse:
    """Test PaymentResponse model."""

    def test_initialization_with_headers(self):
        """Test PaymentResponse initialization with headers."""
        response = PaymentResponse(
            status_code=402,
            body={"error": "Payment required"},
            headers={"PAYMENT-REQUIRED": "encoded_data"}
        )
        assert response.status_code == 402
        assert response.body == {"error": "Payment required"}
        assert response.headers == {"PAYMENT-REQUIRED": "encoded_data"}

    def test_initialization_without_headers(self):
        """Test PaymentResponse initialization without headers."""
        response = PaymentResponse(
            status_code=500,
            body={"error": "Internal server error"}
        )
        assert response.status_code == 500
        assert response.body == {"error": "Internal server error"}
        assert response.headers == {}

    def test_default_headers(self):
        """Test that headers default to empty dict."""
        response = PaymentResponse(
            status_code=200,
            body={"success": True}
        )
        assert isinstance(response.headers, dict)
        assert len(response.headers) == 0


class TestPaymentProceeded:
    """Test PaymentProceeded model."""

    def test_initialization_with_transaction(self):
        """Test PaymentProceeded initialization with transaction."""
        payment = PaymentProceeded(
            paid=True,
            amount=25.50,
            transaction="tx_abc123"
        )
        assert payment.paid is True
        assert payment.amount == 25.50
        assert payment.transaction == "tx_abc123"

    def test_initialization_without_transaction(self):
        """Test PaymentProceeded initialization without transaction."""
        payment = PaymentProceeded(
            paid=True,
            amount=10.0
        )
        assert payment.paid is True
        assert payment.amount == 10.0
        assert payment.transaction is None

    def test_failed_payment(self):
        """Test PaymentProceeded with failed payment."""
        payment = PaymentProceeded(
            paid=False,
            amount=0.0
        )
        assert payment.paid is False
        assert payment.amount == 0.0