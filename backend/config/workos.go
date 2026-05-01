package config

// WorkOS holds WorkOS-related credentials and identifiers.
var WorkOS WorkOSConfig

// WorkOSConfig bundles every WorkOS env var read by the backend.
// All fields are required at startup; missing values fail loudly before
// any handler registers. WebhookSecret was previously read per-request in
// adminHandlers/webhooks.go — moving it here eliminates the silent-empty
// hazard where a missing value would let every request through to the
// signature-check branch.
type WorkOSConfig struct {
	APIKey        string
	ClientID      string
	TokenIssuer   string
	WebhookSecret string
}

// LoadWorkOSConfig reads all WorkOS env vars and validates they're set.
// Does not call usermanagement.SetAPIKey or initialize the JWKS cache —
// those side effects still live in config.SetupWorkOS and auth.InitJWKSCache,
// but they now read from this struct rather than directly from env.
func LoadWorkOSConfig() error {
	var err error
	if WorkOS.APIKey, err = requireEnv("WORKOS_API_KEY"); err != nil {
		return err
	}
	if WorkOS.ClientID, err = requireEnv("WORKOS_CLIENT_ID"); err != nil {
		return err
	}
	if WorkOS.TokenIssuer, err = requireEnv("WORKOS_TOKEN_ISSUER"); err != nil {
		return err
	}
	if WorkOS.WebhookSecret, err = requireEnv("WORKOS_WEBHOOK_SECRET"); err != nil {
		return err
	}
	return nil
}
