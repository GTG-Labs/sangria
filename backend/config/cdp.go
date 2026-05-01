package config

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
	var err error
	if CDP.APIKey, err = requireEnv("CDP_API_KEY"); err != nil {
		return err
	}
	if CDP.APISecret, err = requireEnv("CDP_API_SECRET"); err != nil {
		return err
	}
	if CDP.WalletSecret, err = requireEnv("CDP_WALLET_SECRET"); err != nil {
		return err
	}
	return nil
}
