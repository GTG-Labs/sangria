package handlers

import "github.com/google/uuid"

// generateUUID returns a new random UUID string.
func generateUUID() string {
	return uuid.New().String()
}
