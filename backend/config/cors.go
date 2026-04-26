package config

import (
	"log/slog"
	"os"
	"strings"
)

// CORS holds the parsed CORS allowlist.
var CORS CORSConfig

// CORSConfig holds the ALLOWED_ORIGINS allowlist. Empty list means
// no origins are permitted (and CORS middleware will 403 every
// cross-origin request). A missing env var logs a loud warning at
// startup rather than silently falling back to localhost — the
// previous behavior hid misconfigured prod deploys.
type CORSConfig struct {
	AllowedOrigins []string
}

// LoadCORSConfig reads ALLOWED_ORIGINS (comma-separated). Unset is
// permitted but logged loudly, since same-origin traffic can still
// serve; cross-origin will be rejected.
func LoadCORSConfig() error {
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		slog.Warn("ALLOWED_ORIGINS not set — cross-origin requests will be rejected. Set this env var to enable browser access.")
		CORS.AllowedOrigins = nil
		return nil
	}

	origins := strings.Split(raw, ",")
	cleaned := make([]string, 0, len(origins))
	for _, origin := range origins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	CORS.AllowedOrigins = cleaned
	return nil
}
