package config

import (
	"fmt"
	"os"
	"strings"
)

// CDP holds Coinbase Developer Platform credentials.
var CDP CDPConfig

// CDPConfig bundles all CDP env vars. Previously read in two places
// (cdpHandlers/wallet.go via sync.Once, x402Handlers/facilitator.go per
// call). Centralizing here prevents divergence and lets the handlers
// read typed values rather than re-validate env on every use.
type CDPConfig struct {
	APIKey       string
	APISecret    string
	WalletSecret string
}

// LoadCDPConfig reads and validates CDP_API_KEY, CDP_API_SECRET, and
// CDP_WALLET_SECRET. All three are required because every current CDP
// caller (wallet creation, facilitator JWT signing) needs them.
func LoadCDPConfig() error {
	CDP.APIKey = strings.TrimSpace(os.Getenv("CDP_API_KEY"))
	if CDP.APIKey == "" {
		return fmt.Errorf("CDP_API_KEY environment variable is required")
	}
	CDP.APISecret = strings.TrimSpace(os.Getenv("CDP_API_SECRET"))
	if CDP.APISecret == "" {
		return fmt.Errorf("CDP_API_SECRET environment variable is required")
	}
	CDP.WalletSecret = strings.TrimSpace(os.Getenv("CDP_WALLET_SECRET"))
	if CDP.WalletSecret == "" {
		return fmt.Errorf("CDP_WALLET_SECRET environment variable is required")
	}
	return nil
}
