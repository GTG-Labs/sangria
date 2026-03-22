package config

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/workos/workos-go/v4/pkg/usermanagement"

	"sangrianet/backend/auth"
	dbengine "sangrianet/backend/dbEngine"
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
	log.Println("Connected to database")
	return pool, nil
}