package config

import (
	"log/slog"
	"os"
	"strings"
)

// CORS holds the parsed CORS allowlist.
var CORS CORSConfig

// CORSConfig holds the ALLOWED_ORIGINS allowlist. Empty list means no origins are permitted 
type CORSConfig struct {
	AllowedOrigins []string
}

// LoadCORSConfig reads ALLOWED_ORIGINS (comma-separated). Unset is permitted but logged loudly
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
	if len(cleaned) == 0 {
		slog.Warn("ALLOWED_ORIGINS is set but contains no valid origins after trimming — cross-origin requests will be rejected. Check for stray commas/whitespace in the env var.", "raw", raw)
	}
	CORS.AllowedOrigins = cleaned
	return nil
}
