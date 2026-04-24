package config

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
)

// RateLimit holds rate-limiting configuration loaded from environment.
var RateLimit RateLimitConfig

// RateLimitConfig defines per-bucket request-per-minute limits.
// Each limit is keyed to a different identity (API key, user, org, IP)
// chosen to match the attack surface of the corresponding routes.
// See CRITICAL_SECURITY_ISSUES.md § H1 for the threat model.
type RateLimitConfig struct {
	// V1PerMin caps settlement/generate-payment requests per merchant API key.
	// Protects the facilitator from being flooded with outbound calls.
	V1PerMin int

	// InternalPerMin caps dashboard requests per authenticated WorkOS user.
	InternalPerMin int

	// AdminPerMin caps admin mutations per authenticated admin.
	AdminPerMin int

	// InvitationsPerMin caps invitation sends per organization — tighter than
	// InternalPerMin because each call dispatches a paid Resend email.
	InvitationsPerMin int

	// AcceptInvitationPerMin caps public invitation acceptances per IP.
	// Token is the real auth, but the endpoint is unauthenticated.
	AcceptInvitationPerMin int

	// AuthFailuresPerMin caps failed API-key authentications per IP,
	// blocking brute-force attempts.
	AuthFailuresPerMin int

	// Disabled is a kill switch — when true, every limiter is bypassed.
	// Use for emergency rollback without redeploying.
	Disabled bool

	// WorkOSWebhookAllowedIPs and WorkOSWebhookAllowedCIDRs are the pre-parsed
	// allowlist for POST /webhooks/workos. Parsed once at startup so the
	// per-request check is allocation-free. Invalid entries in the source env
	// var are logged and dropped during LoadRateLimitConfig.
	WorkOSWebhookAllowedIPs   []net.IP
	WorkOSWebhookAllowedCIDRs []*net.IPNet
}

// LoadRateLimitConfig reads rate-limit configuration from environment variables.
func LoadRateLimitConfig() error {
	var err error
	if RateLimit.V1PerMin, err = loadIntEnv("RATE_LIMIT_V1_PER_MIN", 30); err != nil {
		return err
	}
	if RateLimit.InternalPerMin, err = loadIntEnv("RATE_LIMIT_INTERNAL_PER_MIN", 60); err != nil {
		return err
	}
	if RateLimit.AdminPerMin, err = loadIntEnv("RATE_LIMIT_ADMIN_PER_MIN", 100); err != nil {
		return err
	}
	if RateLimit.InvitationsPerMin, err = loadIntEnv("RATE_LIMIT_INVITATIONS_PER_MIN", 10); err != nil {
		return err
	}
	if RateLimit.AcceptInvitationPerMin, err = loadIntEnv("RATE_LIMIT_ACCEPT_INVITATION_PER_MIN", 20); err != nil {
		return err
	}
	if RateLimit.AuthFailuresPerMin, err = loadIntEnv("RATE_LIMIT_AUTH_FAILURES_PER_MIN", 10); err != nil {
		return err
	}

	RateLimit.Disabled = strings.EqualFold(os.Getenv("RATE_LIMIT_DISABLED"), "true")

	RateLimit.WorkOSWebhookAllowedIPs = nil
	RateLimit.WorkOSWebhookAllowedCIDRs = nil
	if ipCSV := os.Getenv("WORKOS_WEBHOOK_ALLOWED_IPS"); ipCSV != "" {
		for _, entry := range strings.Split(ipCSV, ",") {
			trimmed := strings.TrimSpace(entry)
			if trimmed == "" {
				continue
			}
			if strings.Contains(trimmed, "/") {
				_, cidr, cidrErr := net.ParseCIDR(trimmed)
				if cidrErr != nil {
					slog.Warn("workos webhook: invalid CIDR in WORKOS_WEBHOOK_ALLOWED_IPS, skipping",
						"entry", trimmed, "error", cidrErr)
					continue
				}
				RateLimit.WorkOSWebhookAllowedCIDRs = append(RateLimit.WorkOSWebhookAllowedCIDRs, cidr)
				continue
			}
			parsed := net.ParseIP(trimmed)
			if parsed == nil {
				slog.Warn("workos webhook: invalid IP in WORKOS_WEBHOOK_ALLOWED_IPS, skipping",
					"entry", trimmed)
				continue
			}
			RateLimit.WorkOSWebhookAllowedIPs = append(RateLimit.WorkOSWebhookAllowedIPs, parsed)
		}
	}

	return nil
}

// loadIntEnv reads a positive integer env var with a default fallback.
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
