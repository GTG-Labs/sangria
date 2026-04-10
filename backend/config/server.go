package config

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	"sangria/backend/auth"
	dbengine "sangria/backend/dbEngine"
)

// LoadEnvironment loads environment variables from .env file
func LoadEnvironment() {
	godotenv.Load()
}

// SetupWorkOS initializes WorkOS configuration and JWKS cache
func SetupWorkOS() error {
	workosAPIKey := os.Getenv("WORKOS_API_KEY")
	if workosAPIKey == "" {
		return fmt.Errorf("WORKOS_API_KEY environment variable is required")
	}
	workosClientID := os.Getenv("WORKOS_CLIENT_ID")
	if workosClientID == "" {
		return fmt.Errorf("WORKOS_CLIENT_ID environment variable is required")
	}

	usermanagement.SetAPIKey(workosAPIKey)

	return auth.InitJWKSCache(workosClientID)
}

// ConnectDatabase establishes database connection
func ConnectDatabase(ctx context.Context) (*pgxpool.Pool, error) {
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}

	pool, err := dbengine.Connect(ctx, connStr)
	if err != nil {
		return nil, err
	}
	slog.Info("connected to database")
	return pool, nil
}

// GetPort returns the server port from the PORT environment variable.
func GetPort() (string, error) {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		return "", fmt.Errorf("PORT environment variable is required")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("invalid PORT %q: must be integer between 1 and 65535", port)
	}
	return port, nil
}