package config

import (
	"fmt"
	"math"
	"os"
	"strconv"
)

// WithdrawalConfig holds withdrawal configuration loaded from environment.
var WithdrawalConfig WithdrawalSettings

// WithdrawalSettings defines withdrawal parameters.
type WithdrawalSettings struct {
	// AutoApproveThreshold is the max amount (microunits) that auto-approves.
	// Withdrawals above this go to pending_approval for admin review.
	// e.g., 200000000 = $200
	AutoApproveThreshold int64

	// MinAmount is the minimum withdrawal amount in microunits.
	// e.g., 1000000 = $1.00
	MinAmount int64

	// FeeFlat is a flat fee per withdrawal in microunits.
	// e.g., 0 = free, 250000 = $0.25
	FeeFlat int64
}

// CalculateWithdrawalFee returns the fee for a withdrawal.
func (c WithdrawalSettings) CalculateWithdrawalFee(amountMicrounits int64) int64 {
	return c.FeeFlat
}

// ShouldAutoApprove returns true if the withdrawal amount is within
// the auto-approve threshold.
func (c WithdrawalSettings) ShouldAutoApprove(amountMicrounits int64) bool {
	return amountMicrounits <= c.AutoApproveThreshold
}

// LoadWithdrawalConfig reads withdrawal configuration from environment variables.
func LoadWithdrawalConfig() error {
	thresholdStr := os.Getenv("WITHDRAWAL_AUTO_APPROVE_THRESHOLD")
	if thresholdStr == "" {
		thresholdStr = "200000000" // $200
	}
	threshold, err := strconv.ParseFloat(thresholdStr, 64)
	if err != nil {
		return fmt.Errorf("invalid WITHDRAWAL_AUTO_APPROVE_THRESHOLD: %w", err)
	}
	if threshold < 0 {
		return fmt.Errorf("WITHDRAWAL_AUTO_APPROVE_THRESHOLD must be non-negative")
	}

	minStr := os.Getenv("WITHDRAWAL_MIN_AMOUNT")
	if minStr == "" {
		minStr = "1000000" // $1.00
	}
	minAmount, err := strconv.ParseInt(minStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid WITHDRAWAL_MIN_AMOUNT: %w", err)
	}
	if minAmount <= 0 {
		return fmt.Errorf("WITHDRAWAL_MIN_AMOUNT must be positive")
	}

	feeStr := os.Getenv("WITHDRAWAL_FEE_FLAT")
	if feeStr == "" {
		feeStr = "0"
	}
	feeFlat, err := strconv.ParseInt(feeStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid WITHDRAWAL_FEE_FLAT: %w", err)
	}
	if feeFlat < 0 {
		return fmt.Errorf("WITHDRAWAL_FEE_FLAT must be non-negative")
	}

	WithdrawalConfig = WithdrawalSettings{
		AutoApproveThreshold: int64(math.Round(threshold)),
		MinAmount:            minAmount,
		FeeFlat:              feeFlat,
	}

	return nil
}
