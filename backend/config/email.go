package config

import (
	"fmt"
	"os"
	"strings"
)

// Email holds outbound-email configuration (Resend + public frontend URL
// used to build invitation links).
var Email EmailConfig

// EmailConfig bundles Resend credentials and the FRONTEND_URL used to
// construct invitation-accept links. All three were previously read
// per-request in adminHandlers/invitations.go; centralizing here means
// a missing value fails the process at startup rather than after a
// partial DB write.
type EmailConfig struct {
	ResendAPIKey    string
	ResendFromEmail string
	FrontendURL     string
}

// LoadEmailConfig reads and validates RESEND_API_KEY, RESEND_FROM_EMAIL,
// and FRONTEND_URL. All three are required.
func LoadEmailConfig() error {
	Email.ResendAPIKey = strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	if Email.ResendAPIKey == "" {
		return fmt.Errorf("RESEND_API_KEY environment variable is required")
	}
	Email.ResendFromEmail = strings.TrimSpace(os.Getenv("RESEND_FROM_EMAIL"))
	if Email.ResendFromEmail == "" {
		return fmt.Errorf("RESEND_FROM_EMAIL environment variable is required")
	}
	Email.FrontendURL = strings.TrimSpace(os.Getenv("FRONTEND_URL"))
	if Email.FrontendURL == "" {
		return fmt.Errorf("FRONTEND_URL environment variable is required")
	}
	return nil
}
