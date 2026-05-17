package dbengine

import "errors"

// Sentinel errors returned by the agent-side dbEngine functions. Handler code
// branches on these via errors.Is and maps each one to an SDK error class +
// HTTP status code in the agent error catalog.

// ErrPolicyDenied is returned when a /v1/agent/sign request would exceed a
// per-key cap (max-per-call, daily, monthly, or require-confirm). The handler
// attaches the specific sub-reason to the JSON response body.
var ErrPolicyDenied = errors.New("policy denied")

// ErrInsufficientOperatorBalance is returned when the operator's combined
// trial + paid credit balance is less than the upper-bound cost of a payment.
var ErrInsufficientOperatorBalance = errors.New("insufficient operator balance")

// ErrIntentNotPending is returned when /v1/agent/confirm is called on an
// agent_payments row whose status is not pending and not one of the
// already-confirmed / already-failed / unresolved branches handled elsewhere.
var ErrIntentNotPending = errors.New("agent payment intent is not pending")

// ErrIntentAlreadyConfirmed is returned when /v1/agent/confirm is called on
// an already-confirmed row. The handler treats this as an idempotent return.
var ErrIntentAlreadyConfirmed = errors.New("agent payment intent already confirmed")

// ErrIntentUnresolved is returned when /v1/agent/confirm is called on an
// unresolved row. The caller should use the reconcile flow instead.
var ErrIntentUnresolved = errors.New("agent payment intent is unresolved")

// ErrAgentOperatorNotFound is returned when a lookup by organization ID or
// operator ID matches no agent_operators row.
var ErrAgentOperatorNotFound = errors.New("agent operator not found")

// ErrAgentAPIKeyNotFound is returned when a lookup by key ID matches no
// agent_api_keys row.
var ErrAgentAPIKeyNotFound = errors.New("agent API key not found")

// ErrAgentTopupNotFound is returned when a Stripe-webhook lookup by PI ID
// matches no agent_topups row.
var ErrAgentTopupNotFound = errors.New("agent topup not found")

// ErrAgentTopupAlreadyFailed is returned when CompleteStripeAgentTopup is
// called on a topup that has already been marked failed. The webhook handler
// surfaces this as a 200 (the event was processed; the row stays failed).
var ErrAgentTopupAlreadyFailed = errors.New("agent topup already failed")
