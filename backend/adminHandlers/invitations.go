package adminHandlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/resend/resend-go/v3"

	"sangria/backend/auth"
	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
)

// maskEmail masks an email address for logging purposes, preserving first char and domain
func maskEmail(email string) string {
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return "invalid-email"
	}

	local := parts[0]
	domain := parts[1]

	if len(local) <= 1 {
		return "*@" + domain
	}

	// Show first character and mask the rest
	masked := string(local[0]) + strings.Repeat("*", len(local)-1)
	return masked + "@" + domain
}

// maskInvitationURL masks the secret token in invitation URLs for secure logging
func maskInvitationURL(url string) string {
	// Find the token parameter and replace its value
	if idx := strings.Index(url, "token="); idx != -1 {
		beforeToken := url[:idx+6] // includes "token="
		afterToken := ""
		if ampIdx := strings.Index(url[idx:], "&"); ampIdx != -1 {
			afterToken = url[idx+ampIdx:]
		}
		return beforeToken + "***REDACTED***" + afterToken
	}
	return url // Return original if no token found
}

// maskToken masks a secure token for logging purposes
func maskToken(token string) string {
	if len(token) <= 8 {
		return "***REDACTED***"
	}
	// Show first 4 and last 4 characters for debugging, mask the middle
	return token[:4] + "***REDACTED***" + token[len(token)-4:]
}

// generateSecureToken generates a cryptographically secure random token
func generateSecureToken() (string, error) {
	bytes := make([]byte, 32) // 256-bit token
	_, err := rand.Read(bytes)
	if err != nil {
		return "", fmt.Errorf("failed to generate secure token: %w", err)
	}
	return hex.EncodeToString(bytes), nil
}

// sendInvitationEmail sends a beautiful invitation email via Resend
func sendInvitationEmail(ctx context.Context, inviteeEmail, inviterName, orgName, invitationURL, customMessage string) error {
	// Resend credentials + sender are validated at startup via config.LoadEmailConfig.
	client := resend.NewClient(config.Email.ResendAPIKey)
	fromEmail := config.Email.ResendFromEmail

	// Create email subject
	subject := fmt.Sprintf("You're invited to join %s", orgName)

	// Create beautiful HTML email template
	htmlContent := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Join %s</title>
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%%, #764ba2 100%%); padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🎉 You're Invited!</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 18px;">Join %s and start collaborating</p>
    </div>

    <div style="background: white; padding: 40px 30px; border: 1px solid #e1e5e9; border-top: none; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hi there! 👋</p>

        <p style="font-size: 16px; margin-bottom: 20px;">
            <strong>%s</strong> has invited you to join <strong>%s</strong> on Sangria.
        </p>

        %s

        <div style="text-align: center; margin: 40px 0;">
            <a href="%s"
               style="background: linear-gradient(135deg, #667eea 0%%, #764ba2 100%%);
                      color: white;
                      text-decoration: none;
                      padding: 15px 30px;
                      border-radius: 8px;
                      font-size: 16px;
                      font-weight: 600;
                      display: inline-block;
                      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                🚀 Accept Invitation
            </a>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; margin: 30px 0;">
            <p style="margin: 0; font-size: 14px; color: #666;">
                <strong>What happens next?</strong><br>
                1. Click the button above to visit Sangria<br>
                2. Sign in with your email address<br>
                3. You'll be automatically added to the organization
            </p>
        </div>

        <div style="margin-top: 40px; padding-top: 30px; border-top: 1px solid #e1e5e9;">
            <p style="font-size: 14px; color: #666; margin: 0;">
                This invitation will expire in 7 days. If you have any questions, please contact the person who invited you.
            </p>
            <p style="font-size: 13px; color: #999; margin: 10px 0 0 0;">
                ⚠️ This email contains a unique invitation link. Please do not forward or share it with anyone — it grants access to the organization. Sangria will never ask you to share this link.
            </p>
        </div>
    </div>

    <div style="text-align: center; margin-top: 30px;">
        <p style="font-size: 12px; color: #999; margin: 0;">
            Powered by Sangria • Built for teams that ship fast
        </p>
    </div>
</body>
</html>`,
		html.EscapeString(orgName), html.EscapeString(orgName), html.EscapeString(inviterName), html.EscapeString(orgName),
		func() string {
			if customMessage != "" {
				return fmt.Sprintf(`<div style="background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196F3;">
            <p style="margin: 0; font-style: italic; color: #1565C0;">"%s"</p>
        </div>`, html.EscapeString(customMessage))
			}
			return ""
		}(),
		html.EscapeString(invitationURL))

	// Create plain text version
	plainContent := fmt.Sprintf(`You're invited to join %s!

Hi there!

%s has invited you to join %s on Sangria.

%s

Accept your invitation by visiting: %s

What happens next?
1. Click the link above to visit Sangria
2. Sign in with your email address
3. You'll be automatically added to the organization

This invitation will expire in 7 days.

---
Powered by Sangria • Built for teams that ship fast`,
		orgName, inviterName, orgName,
		func() string {
			if customMessage != "" {
				return fmt.Sprintf("Personal message: \"%s\"\n\n", customMessage)
			}
			return ""
		}(),
		invitationURL)

	// Create and send the email
	params := &resend.SendEmailRequest{
		From:    fmt.Sprintf("Sangria Team <%s>", fromEmail),
		To:      []string{inviteeEmail},
		Subject: subject,
		Html:    htmlContent,
		Text:    plainContent,
	}

	sent, err := client.Emails.SendWithContext(ctx, params)
	if err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}

	_ = sent // Email sent successfully, ID available in sent.Id if needed
	return nil
}

// CreateOrganizationInvitation handles POST /organizations/:id/invitations
func CreateOrganizationInvitation(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Get authenticated user from middleware context
		user, ok := c.Locals("workos_user").(auth.WorkOSUser)
		if !ok {
			return c.Status(500).JSON(fiber.Map{"error": "internal server error"})
		}

		orgID := c.Params("id")
		if orgID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "organization ID is required"})
		}

		// Parse request body
		var req struct {
			Email   string  `json:"email"`
			Message *string `json:"message"`
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		// Validate email format
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		if req.Email == "" {
			return c.Status(400).JSON(fiber.Map{"error": "email is required"})
		}

		if !isValidEmail(req.Email) {
			return c.Status(400).JSON(fiber.Map{"error": "invalid email format"})
		}

		// Generate secure invitation token
		invitationToken, err := generateSecureToken()
		if err != nil {
			slog.Error("generate invitation token", "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to generate invitation token"})
		}

		// Create invitation in database with atomic admin check
		message := ""
		if req.Message != nil {
			message = strings.TrimSpace(*req.Message)
			if len(message) > 500 {
				return c.Status(400).JSON(fiber.Map{"error": "message must be 500 characters or less"})
			}
		}

		invitationID, err := dbengine.CreateInvitationWithAdminCheck(c.Context(), pool, orgID, user.ID, req.Email, message, invitationToken)
		if err != nil {
			slog.Error("create invitation", "org_id", orgID, "user_id", user.ID, "email", maskEmail(req.Email), "error", err)

			// Handle permission errors
			if strings.Contains(err.Error(), "not a member") || strings.Contains(err.Error(), "not an admin") {
				return c.Status(403).JSON(fiber.Map{"error": "admin access required to invite members"})
			}

			// Handle duplicate invitation errors (unique_violation from DB)
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return c.Status(400).JSON(fiber.Map{"error": "Invitation already exists for this email"})
			}

			return c.Status(500).JSON(fiber.Map{"error": "failed to create invitation"})
		}

		// Get organization name for the email
		org, err := dbengine.GetOrganization(c.Context(), pool, orgID)
		orgName := "Unknown Organization"
		if err != nil {
			slog.Error("get organization name", "org_id", orgID, "error", err)
		} else {
			orgName = org.Name
		}

		// Get inviter's name/email for the email
		inviterUser, err := dbengine.GetUserByWorkosID(c.Context(), pool, user.ID)
		inviterName := "A team member"
		if err != nil {
			slog.Error("get inviter name", "user_id", user.ID, "error", err)
		} else {
			inviterName = inviterUser.Owner
		}

		// FRONTEND_URL is validated at startup via config.LoadEmailConfig.
		invitationURL := fmt.Sprintf("%s/accept-invitation?token=%s", config.Email.FrontendURL, invitationToken)

		// Send beautiful invitation email via Resend with timeout
		emailCtx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
		defer cancel()
		err = sendInvitationEmail(emailCtx, req.Email, inviterName, orgName, invitationURL, message)
		if err != nil {
			slog.Error("send invitation email", "org_id", orgID, "user_id", user.ID, "email", maskEmail(req.Email), "error", err)

			// Clean up the invitation since email failed - allows retry
			cleanupErr := dbengine.DeleteInvitation(c.Context(), pool, invitationID)
			if cleanupErr != nil {
				slog.Error("failed to clean up invitation after email failure", "invitation_id", invitationID, "error", cleanupErr)
			} else {
				slog.Info("cleaned up invitation after email failure - retry is now possible", "invitation_id", invitationID)
			}

			// Fallback: log the invitation URL for manual sending
			slog.Info("📧 EMAIL FAILED - Send this invitation URL manually",
				"invitation_id", invitationID,
				"email", maskEmail(req.Email),
				"org_name", orgName,
				"invitation_url", maskInvitationURL(invitationURL),
				"error", err.Error(),
			)

			return c.Status(500).JSON(fiber.Map{
				"error": "failed to send invitation email - check Resend configuration",
			})
		}

		slog.Info("✅ Beautiful invitation email sent successfully",
			"invitation_id", invitationID,
			"email", maskEmail(req.Email),
			"org_name", orgName,
			"inviter", inviterName,
			"invitation_url", maskInvitationURL(invitationURL),
		)

		return c.Status(201).JSON(fiber.Map{
			"message":        "Beautiful invitation email sent successfully! 🎉",
			"invitation_id":  invitationID,
			"email":          req.Email,
			"organization":   orgName,
			"provider":       "resend",
		})
	}
}

// isValidEmail validates email format using stdlib net/mail parser
func isValidEmail(email string) bool {
	if email == "" {
		return false
	}

	// Use stdlib parser which handles RFC 5322 compliance
	_, err := mail.ParseAddress(email)
	return err == nil
}

// AcceptOrganizationInvitation handles POST /accept-invitation
// NO AUTH REQUIRED - the secure token is the authentication
func AcceptOrganizationInvitation(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Parse request body - get invitation token
		var req struct {
			Token string `json:"token"`
			Email string `json:"email"` // Optional - for additional validation
		}
		if err := c.Bind().JSON(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}

		if req.Token == "" {
			return c.Status(400).JSON(fiber.Map{"error": "invitation token is required"})
		}

		// Get invitation details
		invitation, err := dbengine.GetInvitationByToken(c.Context(), pool, req.Token)
		if err != nil {
			if errors.Is(err, dbengine.ErrInvitationNotFound) {
				return c.Status(404).JSON(fiber.Map{"error": "invitation not found or expired"})
			}
			slog.Error("get invitation by token", "token", maskToken(req.Token), "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to get invitation"})
		}

		// If email is provided, verify it matches the invitation
		if req.Email != "" {
			req.Email = strings.TrimSpace(strings.ToLower(req.Email))
			if !isValidEmail(req.Email) {
				return c.Status(400).JSON(fiber.Map{"error": "invalid email format"})
			}
			if invitation.InviteeEmail != req.Email {
				return c.Status(403).JSON(fiber.Map{"error": "email does not match invitation"})
			}
		}

		// Check if invitation is already accepted (idempotent behavior for React Strict Mode)
		// This runs before the expiry check so accepted invitations remain valid past expiry.
		if invitation.Status == dbengine.InvitationStatusAccepted {
			slog.Info("Invitation already accepted (idempotent response)",
				"invitation_id", invitation.ID,
				"email", maskEmail(invitation.InviteeEmail),
				"organization_id", invitation.OrganizationID,
			)

			return c.Status(200).JSON(fiber.Map{
				"message":         "Invitation already accepted! You'll be added to the organization when you sign in.",
				"organization_id": invitation.OrganizationID,
			})
		}

		// Check if invitation has expired
		if invitation.ExpiresAt.Before(time.Now()) {
			return c.Status(400).JSON(fiber.Map{"error": "invitation has expired"})
		}

		// Check if invitation is still valid
		if invitation.Status != dbengine.InvitationStatusPending {
			return c.Status(400).JSON(fiber.Map{"error": "invitation is no longer pending"})
		}

		// Just mark the invitation as accepted - don't create user yet
		err = dbengine.MarkInvitationAccepted(c.Context(), pool, req.Token)
		if err != nil {
			slog.Error("mark invitation accepted", "token", maskToken(req.Token), "error", err)
			return c.Status(500).JSON(fiber.Map{"error": "failed to accept invitation"})
		}

		slog.Info("Invitation accepted successfully - user will be created when they sign in with WorkOS",
			"invitation_id", invitation.ID,
			"email", maskEmail(invitation.InviteeEmail),
			"organization_id", invitation.OrganizationID,
		)

		return c.Status(200).JSON(fiber.Map{
			"message":         "Invitation accepted successfully! You'll be added to the organization when you sign in.",
			"organization_id": invitation.OrganizationID,
		})
	}
}