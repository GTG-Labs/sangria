package config

import (
	"fmt"
	"os"
	"strings"
)

// requireEnv reads an env var, trims whitespace, and returns an error if the
// result is empty. Use for required string values; numeric env vars have a
// dedicated helper (loadIntEnv) in rate_limit.go.
func requireEnv(name string) (string, error) {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return "", fmt.Errorf("%s environment variable is required", name)
	}
	return v, nil
}
