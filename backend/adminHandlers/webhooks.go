package adminHandlers

import (
	"encoding/json"
	"log/slog"
	"net"
	"os"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/workos/workos-go/v4/pkg/webhooks"

	"sangria/backend/config"
)

// isWorkOSIPAllowed checks the caller IP against the pre-parsed allowlist
// built at startup by config.LoadRateLimitConfig. Empty allowlist = fail-closed:
// all webhook requests rejected until configured. Only the incoming IP is
// parsed per-request; config entries are already net.IP / *net.IPNet values.
func isWorkOSIPAllowed(ip string) bool {
	// Strip IPv6 zone suffix (e.g. "fe80::1%eth0") before parsing.
	if i := strings.IndexByte(ip, '%'); i >= 0 {
		ip = ip[:i]
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, allowedIP := range config.RateLimit.WorkOSWebhookAllowedIPs {
		if allowedIP.Equal(parsed) {
			return true
		}
	}
	for _, cidr := range config.RateLimit.WorkOSWebhookAllowedCIDRs {
		if cidr.Contains(parsed) {
			return true
		}
	}
	return false
}

// WorkOS webhook event types
const (
	EventTypeInvitationAccepted      = "invitation.accepted"
	EventTypeAuthPasswordSucceeded   = "authentication.password_succeeded"
	EventTypeAuthOAuthSucceeded      = "authentication.oauth_succeeded"
	EventTypeAuthPasswordFailed      = "authentication.password_failed"
	EventTypeSessionCreated          = "session.created"
)

// WorkOS webhook event structure
type WorkOSWebhookEvent struct {
	ID        string                 `json:"id"`
	Event     string                 `json:"event"`
	Data      map[string]interface{} `json:"data"`
	CreatedAt string                 `json:"created_at"`
}

// HandleWorkOSWebhook processes incoming WorkOS webhooks
func HandleWorkOSWebhook(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Reject anything not from WorkOS's published source IPs before any
		// signature work. Prefer X-Envoy-External-Address (set by Railway's
		// Envoy edge from the TCP peer, unspoofable) over c.IP() which trusts
		// client-supplied X-Forwarded-For. Fall back to c.IP() for local dev.
		clientIP := c.Get("X-Envoy-External-Address")
		if clientIP == "" {
			clientIP = c.IP()
		}
		if !isWorkOSIPAllowed(clientIP) {
			slog.Warn("workos webhook: IP not in allowlist", "ip", clientIP)
			return c.Status(403).JSON(fiber.Map{"error": "forbidden"})
		}

		// Get raw request body and signature header
		rawBody := c.Body()
		signature := c.Get("WorkOS-Signature")

		if signature == "" {
			slog.Error("missing WorkOS-Signature header")
			return c.Status(400).JSON(fiber.Map{"error": "missing signature header"})
		}

		// Get webhook secret from environment
		webhookSecret := os.Getenv("WORKOS_WEBHOOK_SECRET")
		if webhookSecret == "" {
			slog.Error("WORKOS_WEBHOOK_SECRET not configured")
			return c.Status(500).JSON(fiber.Map{"error": "webhook validation not configured"})
		}

		// Initialize WorkOS webhook client and validate signature
		webhookClient := webhooks.NewClient(webhookSecret)
		validatedPayload, err := webhookClient.ValidatePayload(signature, string(rawBody))
		if err != nil {
			slog.Error("invalid webhook signature", "error", err)
			return c.Status(400).JSON(fiber.Map{"error": "invalid webhook signature"})
		}

		// Parse validated webhook payload
		var event WorkOSWebhookEvent
		if err := json.Unmarshal([]byte(validatedPayload), &event); err != nil {
			slog.Error("failed to parse webhook payload", "error", err)
			return c.Status(400).JSON(fiber.Map{"error": "invalid webhook payload"})
		}

		slog.Info("received WorkOS webhook", "event_type", event.Event, "event_id", event.ID)

		// Handle different event types - each event fires its own function
		switch event.Event {
		case EventTypeAuthPasswordSucceeded:
			return handleAuthPasswordSucceeded(c, pool, event)
		case EventTypeAuthOAuthSucceeded:
			return handleAuthOAuthSucceeded(c, pool, event)
		case EventTypeAuthPasswordFailed:
			return handleAuthPasswordFailed(c, pool, event)
		case EventTypeSessionCreated:
			return handleSessionCreated(c, pool, event)
		default:
			slog.Info("unhandled webhook event type", "event_type", event.Event)
			return c.Status(200).JSON(fiber.Map{"message": "event type not handled"})
		}
	}
}

// logAuthSuccess handles common auth success logging and response logic
func logAuthSuccess(c fiber.Ctx, event WorkOSWebhookEvent, authType string) error {
	userEmail, _ := event.Data["email"].(string)
	if userEmail != "" {
		userEmail = strings.TrimSpace(strings.ToLower(userEmail))
	}
	userID, _ := event.Data["user_id"].(string)

	slog.Info(authType+" authentication succeeded",
		"event_id", event.ID,
		"workos_user_id", userID,
		"email", maskEmail(userEmail),
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  authType + " authentication logged",
		"event_id": event.ID,
	})
}

// handleAuthPasswordSucceeded processes authentication.password_succeeded events
func handleAuthPasswordSucceeded(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	return logAuthSuccess(c, event, "password")
}

// handleAuthOAuthSucceeded processes authentication.oauth_succeeded events
func handleAuthOAuthSucceeded(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	return logAuthSuccess(c, event, "OAuth")
}

// handleAuthPasswordFailed processes authentication.password_failed events
func handleAuthPasswordFailed(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userEmail, _ := event.Data["email"].(string)
	if userEmail != "" {
		userEmail = strings.TrimSpace(strings.ToLower(userEmail))
	}

	slog.Info("authentication failed",
		"event_id", event.ID,
		"email", maskEmail(userEmail),
		"event_type", event.Event,
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "authentication failure logged",
		"event_id": event.ID,
	})
}

// handleSessionCreated processes session.created events (for logging/analytics)
func handleSessionCreated(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userID, _ := event.Data["user_id"].(string)

	slog.Info("session created",
		"event_id", event.ID,
		"workos_user_id", userID,
		"event_type", event.Event,
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "session creation logged",
		"event_id": event.ID,
	})
}