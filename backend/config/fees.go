package config

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

// PlatformFee holds the fee configuration loaded from environment.
var PlatformFee PlatformFeeConfig

// PlatformFeeConfig defines the platform fee parameters.
type PlatformFeeConfig struct {
	// RateBasisPoints is the fee rate in basis points (1 bp = 0.01%).
	// e.g., 50 = 0.5%, 100 = 1%, 290 = 2.9%
	RateBasisPoints int64
	MinMicrounits   int64 // minimum fee in microunits (1000 = $0.001)
}

// CalculateFee returns the platform fee for a given payment amount in microunits.
// Uses pure integer arithmetic to avoid float rounding.
func (c PlatformFeeConfig) CalculateFee(amountMicrounits int64) int64 {
	// fee = amount * rateBP / 10000
	fee := amountMicrounits * c.RateBasisPoints / 10000
	// Apply minimum fee only when the payment is large enough to cover it.
	// For micropayments smaller than the minimum, just use the percentage fee
	// so the merchant still receives something.
	if fee < c.MinMicrounits && c.MinMicrounits <= amountMicrounits {
		fee = c.MinMicrounits
	}
	return fee
}

// LoadPlatformFees reads fee configuration from environment variables.
// PLATFORM_FEE_PERCENT is a human-readable percentage (e.g., "0.5" = 0.5%)
// that gets converted to basis points internally (0.5% = 50 bp).
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
	// Convert percent to basis points: 0.5% → 50bp, 2.9% → 290bp
	rateBP := int64(math.Round(percent * 100))

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
		RateBasisPoints: rateBP,
		MinMicrounits:   minMicro,
	}

	return nil
}
