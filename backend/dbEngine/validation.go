package dbengine

import "fmt"

// ValidateAmountAndFee checks that amount is positive, fee is non-negative,
// and fee does not exceed amount. Returns an error describing the first
// violation found, or nil if the inputs are valid.
func ValidateAmountAndFee(amount, fee int64) error {
	if amount <= 0 {
		return fmt.Errorf("amount must be positive, got %d", amount)
	}
	if fee < 0 {
		return fmt.Errorf("fee must be non-negative, got %d", fee)
	}
	if fee > amount {
		return fmt.Errorf("fee (%d) exceeds amount (%d)", fee, amount)
	}
	return nil
}
