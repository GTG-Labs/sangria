package config

import (
	"fmt"
	"os"
	"strings"
)

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
	WorkOS.APIKey = strings.TrimSpace(os.Getenv("WORKOS_API_KEY"))
	if WorkOS.APIKey == "" {
		return fmt.Errorf("WORKOS_API_KEY environment variable is required")
	}
	WorkOS.ClientID = strings.TrimSpace(os.Getenv("WORKOS_CLIENT_ID"))
	if WorkOS.ClientID == "" {
		return fmt.Errorf("WORKOS_CLIENT_ID environment variable is required")
	}
	WorkOS.TokenIssuer = strings.TrimSpace(os.Getenv("WORKOS_TOKEN_ISSUER"))
	if WorkOS.TokenIssuer == "" {
		return fmt.Errorf("WORKOS_TOKEN_ISSUER environment variable is required")
	}
	WorkOS.WebhookSecret = strings.TrimSpace(os.Getenv("WORKOS_WEBHOOK_SECRET"))
	if WorkOS.WebhookSecret == "" {
		return fmt.Errorf("WORKOS_WEBHOOK_SECRET environment variable is required")
	}
	return nil
}
