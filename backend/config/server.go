package config

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"

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

// SetupWorkOS initializes the WorkOS SDK and JWKS cache from pre-loaded
// WorkOSConfig values. Caller must have invoked LoadWorkOSConfig() first.
func SetupWorkOS() error {
	if WorkOS.APIKey == "" || WorkOS.ClientID == "" {
		return fmt.Errorf("SetupWorkOS called before LoadWorkOSConfig — WorkOS config not populated")
	}
	usermanagement.SetAPIKey(WorkOS.APIKey)
	return auth.InitJWKSCache(WorkOS.ClientID, WorkOS.TokenIssuer)
}

// ConnectDatabase establishes database connection
func ConnectDatabase(ctx context.Context) (*pgxpool.Pool, error) {
	connStr, err := requireEnv("DATABASE_URL")
	if err != nil {
		return nil, err
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
	port, err := requireEnv("PORT")
	if err != nil {
		return "", err
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("invalid PORT %q: must be integer between 1 and 65535", port)
	}
	return port, nil
}