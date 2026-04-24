package config

import (
	"fmt"
	"os"
	"strconv"
)

// PaymentConfig holds payment-level policy loaded from the environment.
var PaymentConfig PaymentConfiguration

// PaymentConfiguration defines per-payment policy knobs.
type PaymentConfiguration struct {
	// MaxAmountMicrounits is the maximum value accepted for a single payment.
	MaxAmountMicrounits int64
}

// Default max: $1,000,000 = 10^12 microunits, well below int64's range
const defaultPaymentMaxMicrounits int64 = 1_000_000_000_000

// LoadPaymentConfig reads payment policy from environment variables.
func LoadPaymentConfig() error {
	maxStr := os.Getenv("PAYMENT_MAX_MICROUNITS")
	if maxStr == "" {
		PaymentConfig = PaymentConfiguration{MaxAmountMicrounits: defaultPaymentMaxMicrounits}
		return nil
	}

	maxMicro, err := strconv.ParseInt(maxStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid PAYMENT_MAX_MICROUNITS: %w", err)
	}
	if maxMicro <= 0 {
		return fmt.Errorf("PAYMENT_MAX_MICROUNITS must be positive, got %d", maxMicro)
	}

	PaymentConfig = PaymentConfiguration{MaxAmountMicrounits: maxMicro}
	return nil
}
