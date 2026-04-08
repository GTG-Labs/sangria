package config

import (
	"fmt"
	"os"
	"strconv"
)

// PlatformFee holds the fee configuration loaded from environment.
var PlatformFee PlatformFeeConfig

// PlatformFeeConfig defines the platform fee parameters.
type PlatformFeeConfig struct {
	Percent       float64 // e.g., 0.5 means 0.5%
	MinMicrounits int64   // minimum fee in microunits (1000 = $0.001)
}

// CalculateFee returns the platform fee for a given payment amount in microunits.
func (c PlatformFeeConfig) CalculateFee(amountMicrounits int64) int64 {
	fee := int64(float64(amountMicrounits) * c.Percent / 100.0)
	// Apply minimum fee only when the payment is large enough to cover it.
	// For micropayments smaller than the minimum, just use the percentage fee
	// so the merchant still receives something.
	if fee < c.MinMicrounits && c.MinMicrounits <= amountMicrounits {
		fee = c.MinMicrounits
	}
	return fee
}

// LoadPlatformFees reads fee configuration from environment variables.
func LoadPlatformFees() error {
	percentStr := os.Getenv("PLATFORM_FEE_PERCENT")
	if percentStr == "" {
		percentStr = "0"
	}
	percent, err := strconv.ParseFloat(percentStr, 64)
	if err != nil {
		return fmt.Errorf("invalid PLATFORM_FEE_PERCENT: %w", err)
	}
	if percent < 0 || percent > 100 {
		return fmt.Errorf("PLATFORM_FEE_PERCENT must be between 0 and 100, got %f", percent)
	}

	minStr := os.Getenv("PLATFORM_FEE_MIN_MICROUNITS")
	if minStr == "" {
		minStr = "0"
	}
	minMicro, err := strconv.ParseInt(minStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid PLATFORM_FEE_MIN_MICROUNITS: %w", err)
	}
	if minMicro < 0 {
		return fmt.Errorf("PLATFORM_FEE_MIN_MICROUNITS must be non-negative, got %d", minMicro)
	}

	PlatformFee = PlatformFeeConfig{
		Percent:       percent,
		MinMicrounits: minMicro,
	}

	return nil
}
