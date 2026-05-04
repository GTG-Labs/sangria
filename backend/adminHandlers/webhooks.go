package adminHandlers

import (
	"encoding/json"
	"log/slog"
	"net"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/workos/workos-go/v4/pkg/webhooks"

	"sangria/backend/config"
)

// Package-level WorkOS webhook signature client. Lazy-init on first request
// via sync.Once so the secret is read after config.LoadWorkOSConfig has run.
// Reused across every webhook hit rather than re-allocating per request.
var (
	webhookClient     *webhooks.Client
	webhookClientOnce sync.Once
)

func getWebhookClient() *webhooks.Client {
	webhookClientOnce.Do(func() {
		webhookClient = webhooks.NewClient(config.WorkOS.WebhookSecret)
	})
	return webhookClient
}

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
	EventTypeInvitationAccepted          = "invitation.accepted"
	EventTypeAuthPasswordSucceeded       = "authentication.password_succeeded"
	EventTypeAuthOAuthSucceeded          = "authentication.oauth_succeeded"
	EventTypeAuthPasswordFailed          = "authentication.password_failed"
	EventTypeSessionCreated              = "session.created"
	EventTypeUserCreated                 = "user.created"
	EventTypeUserUpdated                 = "user.updated"
	EventTypeUserDeleted                 = "user.deleted"
	EventTypeSessionRevoked              = "session.revoked"
	EventTypeEmailVerificationCreated    = "email_verification.created"
	EventTypeEmailVerificationSucceeded  = "authentication.email_verification_succeeded"
	// Note: organization events are handled via JWT user creation, not webhooks
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

		// Webhook secret is validated at startup via config.LoadWorkOSConfig;
		// signing client is built lazily once via sync.Once.
		validatedPayload, err := getWebhookClient().ValidatePayload(signature, string(rawBody))
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
		case EventTypeUserCreated:
			return handleUserCreated(c, pool, event)
		case EventTypeUserUpdated:
			return handleUserUpdated(c, pool, event)
		case EventTypeUserDeleted:
			return handleUserDeleted(c, pool, event)
		case EventTypeSessionRevoked:
			return handleSessionRevoked(c, pool, event)
		case EventTypeEmailVerificationCreated:
			return handleEmailVerificationCreated(c, pool, event)
		case EventTypeEmailVerificationSucceeded:
			return handleEmailVerificationSucceeded(c, pool, event)
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

// handleUserCreated processes user.created events (logging only - user creation handled via JWT)
func handleUserCreated(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userID, _ := event.Data["id"].(string)
	email, _ := event.Data["email"].(string)
	if email != "" {
		email = strings.TrimSpace(strings.ToLower(email))
	}

	slog.Info("user created",
		"event_id", event.ID,
		"workos_user_id", userID,
		"email", maskEmail(email),
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "user creation logged",
		"event_id": event.ID,
	})
}

// handleUserUpdated processes user.updated events
func handleUserUpdated(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userID, _ := event.Data["id"].(string)
	email, _ := event.Data["email"].(string)
	if email != "" {
		email = strings.TrimSpace(strings.ToLower(email))
	}

	slog.Info("user updated",
		"event_id", event.ID,
		"workos_user_id", userID,
		"email", maskEmail(email),
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "user update logged",
		"event_id": event.ID,
	})
}

// handleUserDeleted processes user.deleted events
func handleUserDeleted(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userID, _ := event.Data["id"].(string)

	slog.Info("user deleted",
		"event_id", event.ID,
		"workos_user_id", userID,
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "user deletion logged",
		"event_id": event.ID,
	})
}

// handleSessionRevoked processes session.revoked events
func handleSessionRevoked(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userID, _ := event.Data["user_id"].(string)

	slog.Info("session revoked",
		"event_id", event.ID,
		"workos_user_id", userID,
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "session revocation logged",
		"event_id": event.ID,
	})
}

// handleEmailVerificationCreated processes email_verification.created events
func handleEmailVerificationCreated(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userID, _ := event.Data["user_id"].(string)

	slog.Info("email verification created",
		"event_id", event.ID,
		"workos_user_id", userID,
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "email verification creation logged",
		"event_id": event.ID,
	})
}

// handleEmailVerificationSucceeded processes authentication.email_verification_succeeded events
func handleEmailVerificationSucceeded(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	userID, _ := event.Data["user_id"].(string)
	email, _ := event.Data["email"].(string)
	if email != "" {
		email = strings.TrimSpace(strings.ToLower(email))
	}

	slog.Info("email verification succeeded",
		"event_id", event.ID,
		"workos_user_id", userID,
		"email", maskEmail(email),
	)

	return c.Status(200).JSON(fiber.Map{
		"message":  "email verification success logged",
		"event_id": event.ID,
	})
}