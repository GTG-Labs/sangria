// Package clientHandlers implements the WorkOS-authenticated /internal/client/*
// surface that the agent-operator dashboard consumes. It mirrors the
// /v1/agent/* runtime surface (in agentHandlers) one-to-one in terms of the
// underlying data, but auth flips from agent API key to WorkOS session JWT.
//
// The two surfaces converge on the same dbEngine functions and the same
// Postgres rows; only the auth/route prefix and the response shapes differ.
package clientHandlers

import (
	"github.com/stripe/stripe-go/v82"

	"sangria/backend/config"
)

// InitStripeClient wires the stripe-go global from the loaded StripeConfig.
// Called from main.go after LoadStripeConfig so the SDK key is set exactly
// once, before any handler can fire. Mirrors adminHandlers.InitEmailClient.
func InitStripeClient() {
	stripe.Key = config.Stripe.SecretKey
}
