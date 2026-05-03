package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// requireEnv reads an env var, trims whitespace, and returns an error if the
// result is empty. Use for required string values; numeric env vars with a
// default fallback should use loadIntEnv instead.
func requireEnv(name string) (string, error) {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return "", fmt.Errorf("%s environment variable is required", name)
	}
	return v, nil
}

// loadIntEnv reads a positive integer env var with a default fallback.
// Returns the fallback when the var is unset, an error when set but not a
// valid integer or not positive.
func loadIntEnv(name string, fallback int) (int, error) {
	raw := os.Getenv(name)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", name, err)
	}
	if n <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %d", name, n)
	}
	return n, nil
}
