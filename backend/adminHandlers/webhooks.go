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
	dbengine "sangria/backend/dbEngine"
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
	EventTypeInvitationAccepted = "invitation.accepted"
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

		// Handle different event types
		switch event.Event {
		case EventTypeInvitationAccepted:
			return handleInvitationAccepted(c, pool, event)
		default:
			slog.Info("unhandled webhook event type", "event_type", event.Event)
			return c.Status(200).JSON(fiber.Map{"message": "event type not handled"})
		}
	}
}

// handleInvitationAccepted processes invitation.accepted events
func handleInvitationAccepted(c fiber.Ctx, pool *pgxpool.Pool, event WorkOSWebhookEvent) error {
	// Extract relevant data from the event
	invitationData, ok := event.Data["invitation"].(map[string]interface{})
	if !ok {
		slog.Error("invalid invitation data in webhook", "event_id", event.ID)
		return c.Status(400).JSON(fiber.Map{"error": "invalid invitation data"})
	}

	userData, ok := event.Data["user"].(map[string]interface{})
	if !ok {
		slog.Error("invalid user data in webhook", "event_id", event.ID)
		return c.Status(400).JSON(fiber.Map{"error": "invalid user data"})
	}

	// Extract required fields
	organizationID, ok := invitationData["organization_id"].(string)
	if !ok || organizationID == "" {
		slog.Error("missing organization_id in webhook", "event_id", event.ID)
		return c.Status(400).JSON(fiber.Map{"error": "missing organization_id"})
	}

	userID, ok := userData["id"].(string)
	if !ok || userID == "" {
		slog.Error("missing user id in webhook", "event_id", event.ID)
		return c.Status(400).JSON(fiber.Map{"error": "missing user id"})
	}

	userEmail, ok := userData["email"].(string)
	if !ok || userEmail == "" {
		slog.Error("missing user email in webhook", "event_id", event.ID)
		return c.Status(400).JSON(fiber.Map{"error": "missing user email"})
	}
	userEmail = strings.TrimSpace(strings.ToLower(userEmail))

	slog.Info("processing invitation acceptance",
		"user_id", userID,
		"organization_id", organizationID,
		"event_id", event.ID,
	)

	// Begin transaction
	tx, err := pool.Begin(c.Context())
	if err != nil {
		slog.Error("failed to begin transaction", "error", err)
		return c.Status(500).JSON(fiber.Map{"error": "failed to begin transaction"})
	}
	defer tx.Rollback(c.Context())

	// Ensure the user exists in our database
	userName := userEmail // Default to email
	if firstName, ok := userData["first_name"].(string); ok && firstName != "" {
		if lastName, ok := userData["last_name"].(string); ok && lastName != "" {
			userName = firstName + " " + lastName
		} else {
			userName = firstName
		}
	}

	_, err = dbengine.UpsertUserTx(c.Context(), tx, userName, userID)
	if err != nil {
		slog.Error("failed to upsert user", "user_id", userID, "error", err)
		return c.Status(500).JSON(fiber.Map{"error": "failed to upsert user"})
	}

	// Add user to organization as a member (not admin)
	err = dbengine.AddUserToOrganizationTx(c.Context(), tx, userID, organizationID, false)
	if err != nil {
		slog.Error("failed to add user to organization",
			"user_id", userID,
			"organization_id", organizationID,
			"error", err,
		)
		return c.Status(500).JSON(fiber.Map{"error": "failed to add user to organization"})
	}

	// Commit the transaction
	if err := tx.Commit(c.Context()); err != nil {
		slog.Error("failed to commit transaction", "error", err)
		return c.Status(500).JSON(fiber.Map{"error": "failed to commit transaction"})
	}

	slog.Info("successfully processed invitation acceptance",
		"user_id", userID,
		"organization_id", organizationID,
		"event_id", event.ID,
	)

	return c.Status(200).JSON(fiber.Map{
		"message": "invitation acceptance processed successfully",
		"event_id": event.ID,
	})
}