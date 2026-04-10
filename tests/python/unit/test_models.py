"""Unit tests for Sangria Python SDK models."""

import pytest
from sangria_sdk.models import (
    FixedPriceOptions,
    PaymentResponse,
    PaymentProceeded,
)


class TestFixedPriceOptions:
    """Test FixedPriceOptions model."""

    def test_valid_construction(self):
        """Test valid FixedPriceOptions creation."""
        options = FixedPriceOptions(
            price=10.50,
            resource="/premium-content",
            description="Premium article access"
        )
        assert options.price == 10.50
        assert options.resource == "/premium-content"
        assert options.description == "Premium article access"

    def test_construction_without_description(self):
        """Test FixedPriceOptions creation without optional description."""
        options = FixedPriceOptions(
            price=5.00,
            resource="/api/data"
        )
        assert options.price == 5.00
        assert options.resource == "/api/data"
        assert options.description is None

    @pytest.mark.parametrize("invalid_price", [
        0,
        -1.0,
        float('inf'),
        float('nan')
    ])
    def test_invalid_price_values(self, invalid_price):
        """Test that invalid price values raise ValueError."""
        with pytest.raises(ValueError, match="price must be a finite number greater than 0"):
            FixedPriceOptions(price=invalid_price, resource="/test")

    def test_to_generate_dict_with_description(self):
        """Test to_generate_dict method with description."""
        options = FixedPriceOptions(
            price=15.99,
            resource="/premium",
            description="Premium access"
        )
        expected = {
            "amount": 15.99,
            "resource": "/premium",
            "description": "Premium access"
        }
        assert options.to_generate_dict() == expected

    def test_to_generate_dict_without_description(self):
        """Test to_generate_dict method without description."""
        options = FixedPriceOptions(
            price=5.00,
            resource="/basic"
        )
        expected = {
            "amount": 5.00,
            "resource": "/basic"
        }
        assert options.to_generate_dict() == expected


class TestPaymentResponse:
    """Test PaymentResponse model."""

    def test_construction_with_headers(self):
        """Test PaymentResponse creation with headers."""
        response = PaymentResponse(
            status_code=402,
            body={"error": "Payment required"},
            headers={"PAYMENT-REQUIRED": "encoded_data"}
        )
        assert response.status_code == 402
        assert response.body == {"error": "Payment required"}
        assert response.headers == {"PAYMENT-REQUIRED": "encoded_data"}

    def test_construction_without_headers(self):
        """Test PaymentResponse creation without headers."""
        response = PaymentResponse(
            status_code=500,
            body={"error": "Internal server error"}
        )
        assert response.status_code == 500
        assert response.body == {"error": "Internal server error"}
        assert response.headers == {}

    def test_construction_empty_headers(self):
        """Test PaymentResponse creation with empty headers."""
        response = PaymentResponse(
            status_code=402,
            body={"challenge": "payment_data"},
            headers={}
        )
        assert response.status_code == 402
        assert response.body == {"challenge": "payment_data"}
        assert response.headers == {}


class TestPaymentProceeded:
    """Test PaymentProceeded model."""

    def test_construction_complete(self):
        """Test PaymentProceeded creation with all fields."""
        payment = PaymentProceeded(
            paid=True,
            amount=25.00,
            transaction="tx_abc123"
        )
        assert payment.paid is True
        assert payment.amount == 25.00
        assert payment.transaction == "tx_abc123"

    def test_construction_without_transaction(self):
        """Test PaymentProceeded creation without transaction."""
        payment = PaymentProceeded(
            paid=True,
            amount=10.00
        )
        assert payment.paid is True
        assert payment.amount == 10.00
        assert payment.transaction is None

    def test_construction_unpaid(self):
        """Test PaymentProceeded creation with paid=False."""
        payment = PaymentProceeded(
            paid=False,
            amount=0.00
        )
        assert payment.paid is False
        assert payment.amount == 0.00
        assert payment.transaction is None


class TestPaymentResult:
    """Test PaymentResult union type."""

    def test_payment_response_is_valid_result(self):
        """Test that PaymentResponse is a valid PaymentResult."""
        response = PaymentResponse(status_code=402, body={"error": "test"})
        assert isinstance(response, (PaymentResponse, PaymentProceeded))

    def test_payment_proceeded_is_valid_result(self):
        """Test that PaymentProceeded is a valid PaymentResult."""
        proceeded = PaymentProceeded(paid=True, amount=5.00)
        assert isinstance(proceeded, (PaymentResponse, PaymentProceeded))