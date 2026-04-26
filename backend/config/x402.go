package config

import (
	"fmt"
	"os"
	"strings"
)

// X402 holds x402-protocol-related configuration.
var X402 X402Config

// X402Config currently carries just the facilitator URL.
// Previously read per-request in x402Handlers/facilitator.go — moving here
// lets the handler be allocation-free on the hot path.
type X402Config struct {
	FacilitatorURL string
}

// LoadX402Config reads and validates X402_FACILITATOR_URL.
func LoadX402Config() error {
	X402.FacilitatorURL = strings.TrimSpace(os.Getenv("X402_FACILITATOR_URL"))
	if X402.FacilitatorURL == "" {
		return fmt.Errorf("X402_FACILITATOR_URL environment variable is required")
	}
	return nil
}
