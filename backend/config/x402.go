package config

import (
	"fmt"
	"net/url"
)

// X402 holds x402-protocol-related configuration.
var X402 X402Config

// X402Config currently carries just the facilitator URL.
// Previously read per-request in x402Handlers/facilitator.go — moving here
// lets the handler be allocation-free on the hot path.
type X402Config struct {
	FacilitatorURL string
}

// LoadX402Config reads X402_FACILITATOR_URL and validates it's a well-formed
// http(s) URL. Parsing here means a typo like "htps://..." fails startup
// rather than every facilitator call, where the error would be a confusing
// "no such host" or "missing scheme" mid-request.
func LoadX402Config() error {
	raw, err := requireEnv("X402_FACILITATOR_URL")
	if err != nil {
		return err
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid X402_FACILITATOR_URL %q: %w", raw, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("invalid X402_FACILITATOR_URL %q: scheme must be http or https, got %q", raw, parsed.Scheme)
	}
	if parsed.Host == "" {
		return fmt.Errorf("invalid X402_FACILITATOR_URL %q: missing host", raw)
	}
	X402.FacilitatorURL = raw
	return nil
}
