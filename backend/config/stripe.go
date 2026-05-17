package config

// Stripe holds Stripe API credentials. Loaded once at startup; subsequent
// reads (in clientHandlers/topups.go, stripeWebhook.go, cards.go) hit this
// global rather than os.Getenv so the secret never leaks through a stray
// per-request read.
var Stripe StripeConfig

// StripeConfig bundles the three Stripe values the backend touches:
//   - SecretKey:   server-side API access (PaymentIntent.create, Customer.create, etc.)
//   - WebhookSecret: HMAC for /webhooks/stripe signature verification
//   - PublishableKey: echoed to the frontend so it can initialize Stripe.js
//     against the same account; pairs the publishable & secret keys at the
//     config layer (single source of truth) instead of asking the frontend
//     to maintain a NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY that could drift.
type StripeConfig struct {
	SecretKey      string
	WebhookSecret  string
	PublishableKey string
}

// LoadStripeConfig reads and validates the three required Stripe env vars.
func LoadStripeConfig() error {
	var err error
	if Stripe.SecretKey, err = requireEnv("STRIPE_SECRET_KEY"); err != nil {
		return err
	}
	if Stripe.WebhookSecret, err = requireEnv("STRIPE_WEBHOOK_SECRET"); err != nil {
		return err
	}
	if Stripe.PublishableKey, err = requireEnv("STRIPE_PUBLISHABLE_KEY"); err != nil {
		return err
	}
	return nil
}
