package config

import (
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
	var err error
	if Email.ResendAPIKey, err = requireEnv("RESEND_API_KEY"); err != nil {
		return err
	}
	if Email.ResendFromEmail, err = requireEnv("RESEND_FROM_EMAIL"); err != nil {
		return err
	}
	if Email.FrontendURL, err = requireEnv("FRONTEND_URL"); err != nil {
		return err
	}
	// Strip a single trailing slash so callers can append paths (e.g.
	// "/accept-invitation?token=...") without producing "//".
	Email.FrontendURL = strings.TrimSuffix(Email.FrontendURL, "/")
	return nil
}
