package config

import (
	"fmt"
	"net/url"
)

// Merchant holds configuration for the single merchant Sangria currently
// routes /v1/buy traffic to. V1 supports exactly one merchant, configured
// via env var; multi-merchant routing will reintroduce a merchants_catalog
// table when that work lands.
var Merchant MerchantConfig

// MerchantConfig carries the URL Sangria GETs at /v1/buy time to fetch the
// merchant's product catalog. The catalog response itself declares the buy
// endpoint path, auth scheme, and other per-merchant metadata — Sangria
// stores nothing about the merchant beyond this entry point.
type MerchantConfig struct {
	CatalogURL string
}

// LoadMerchantConfig reads MERCHANT_CATALOG_URL and validates it's a
// well-formed http(s) URL. Same pattern as LoadX402Config — parsing here
// means a typo fails startup rather than every /v1/buy call.
func LoadMerchantConfig() error {
	raw, err := requireEnv("MERCHANT_CATALOG_URL")
	if err != nil {
		return err
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid MERCHANT_CATALOG_URL %q: %w", raw, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("invalid MERCHANT_CATALOG_URL %q: scheme must be http or https, got %q", raw, parsed.Scheme)
	}
	if parsed.Host == "" {
		return fmt.Errorf("invalid MERCHANT_CATALOG_URL %q: missing host", raw)
	}
	Merchant.CatalogURL = raw
	return nil
}
