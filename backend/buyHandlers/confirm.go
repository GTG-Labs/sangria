package buyHandlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"

	"sangria/backend/config"
	dbengine "sangria/backend/dbEngine"
	"sangria/backend/sangriamerchant"
)

// Confirm is the POST /v1/buy/{id}/confirm handler. Charges the operator
// (debits credits, accrues Merchant Settlement Payable) and calls the
// merchant's /buy endpoint with the operator's contact info + shipping
// address. The biggest handler in the package — see
// agent-sdk-planning/BUY_ENDPOINT_PLAN.md § POST /v1/buy/{id}/confirm
// for the full 11-step flow.
//
// Auth: agent API key. Mutating endpoint — key-scoped ownership (only the
// agent key that created the quote can confirm it).
func Confirm(pool *pgxpool.Pool) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx := c.Context()

		// 1. Read locals + path param.
		apiKey, ok := c.Locals("agent_api_key").(*dbengine.AgentAPIKey)
		if !ok || apiKey == nil {
			slog.Error("agent_api_key local missing on POST /v1/buy/:id/confirm")
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("auth_context_missing"))
		}
		operator, ok := c.Locals("agent_operator").(*dbengine.AgentOperator)
		if !ok || operator == nil {
			slog.Error("agent_operator local missing on POST /v1/buy/:id/confirm")
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("auth_context_missing"))
		}
		orderID := strings.TrimSpace(c.Params("id"))
		if orderID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("invalid_request", "id"))
		}

		// 2. Look up the order.
		order, err := dbengine.GetOrderByID(ctx, pool, orderID)
		if errors.Is(err, dbengine.ErrOrderNotFound) {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}
		if err != nil {
			slog.Error("get order by ID", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("order_read_failed"))
		}

		// 3. Ownership check (mutate — key-scoped). Sibling keys under the
		// same operator can't confirm each other's orders; only the creating
		// key may.
		if order.AgentAPIKeyID != apiKey.ID {
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}

		// 4. Status branch — terminal/in-flight states return idempotently
		// with the current state. The order's already past the point where
		// /confirm could do anything new.
		switch order.Status {
		case dbengine.OrderStatusCancelled,
			dbengine.OrderStatusFailed,
			dbengine.OrderStatusCompleted,
			dbengine.OrderStatusRunning:
			catalog, err := fetchCatalogForResponse(ctx)
			if err != nil {
				return c.Status(fiber.StatusServiceUnavailable).JSON(errorJSON("merchant_unreachable"))
			}
			return c.Status(fiber.StatusOK).JSON(serializeOrder(order, catalog))
		case dbengine.OrderStatusAwaitingConfirmation:
			// proceed
		default:
			slog.Error("unexpected order status", "order_id", orderID, "status", order.Status)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("internal_error"))
		}

		// 5. Expiry check.
		if time.Now().UTC().After(order.ExpiresAt) {
			if _, err := dbengine.CancelOrder(ctx, pool, orderID); err != nil &&
				!errors.Is(err, dbengine.ErrOrderNotInExpectedState) {
				// ErrOrderNotInExpectedState is harmless here — a concurrent
				// /cancel raced and got there first. Anything else is a real
				// error worth surfacing.
				slog.Error("cancel expired order", "order_id", orderID, "error", err)
			}
			return c.Status(fiber.StatusConflict).JSON(errorJSON("quote_expired"))
		}

		// 6. Operator profile validation — per-field, first-missing wins
		// for the sub-reason so retries always see the same message.
		if operator.Email == nil || strings.TrimSpace(*operator.Email) == "" {
			cancelOrderQuiet(ctx, pool, orderID)
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("missing_operator_profile", "email"))
		}
		if operator.Phone == nil || strings.TrimSpace(*operator.Phone) == "" {
			cancelOrderQuiet(ctx, pool, orderID)
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("missing_operator_profile", "phone"))
		}
		addr, err := dbengine.ParseOperatorAddress(operator.Address)
		if err != nil {
			slog.Error("parse operator address", "operator_id", operator.ID, "error", err)
			cancelOrderQuiet(ctx, pool, orderID)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("operator_address_corrupt"))
		}
		if addr.Shipping == nil {
			cancelOrderQuiet(ctx, pool, orderID)
			return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("missing_operator_profile", "address.shipping"))
		}
		shipping := *addr.Shipping
		for _, missing := range []struct {
			field string
			value string
		}{
			{"address.shipping.line1", shipping.Line1},
			{"address.shipping.city", shipping.City},
			{"address.shipping.state", shipping.State},
			{"address.shipping.postal_code", shipping.PostalCode},
			{"address.shipping.country", shipping.Country},
		} {
			if strings.TrimSpace(missing.value) == "" {
				cancelOrderQuiet(ctx, pool, orderID)
				return c.Status(fiber.StatusBadRequest).JSON(errorJSONWithField("missing_operator_profile", missing.field))
			}
		}

		// 7. Re-fetch the catalog (10s budget) to re-validate service-area
		// and read the current BuyEndpoint.Path + .Auth. Fail-closed on
		// merchant-unreachable; leave the order in awaiting_confirmation so
		// the agent can retry within the quote TTL.
		catalogCtx, catalogCancel := context.WithTimeout(ctx, catalogTimeout)
		defer catalogCancel()
		catalog, err := merchantClient.FetchCatalog(catalogCtx, config.Merchant.CatalogURL)
		if err != nil {
			slog.Warn("fetch merchant catalog at confirm", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusServiceUnavailable).JSON(errorJSON("merchant_unreachable"))
		}
		if !serviceAreaCovers(catalog.Store.ServiceArea, strings.TrimSpace(shipping.State)) {
			cancelOrderQuiet(ctx, pool, orderID)
			return c.Status(fiber.StatusBadRequest).JSON(errorJSON("service_area_mismatch"))
		}
		if catalog.BuyEndpoint.Auth != "sangria" {
			cancelOrderQuiet(ctx, pool, orderID)
			return c.Status(fiber.StatusNotImplemented).JSON(errorJSON("unsupported_auth"))
		}

		// 8. Create the payment row (FOR UPDATE balance check inside
		// CreateAgentPayment — race-safe). Deterministic idempotency key
		// means retries of /confirm for the same order get the same payment
		// row back.
		validBefore := order.ExpiresAt.Add(5 * time.Minute) // placeholder; matters when CDP signs
		payment, err := dbengine.CreateAgentPayment(ctx, pool, dbengine.CreateAgentPaymentParams{
			IdempotencyKey:      "order-confirm-" + orderID,
			APIKeyID:            apiKey.ID,
			AgentOperatorID:     operator.ID,
			PaymentType:         dbengine.AgentPaymentTypeSangriaNative,
			MerchantURLOrHost:   config.Merchant.CatalogURL,
			MaxAmountMicrounits: order.QuoteAmountMicrounits,
			UpperBoundCost:      order.QuoteAmountMicrounits, // no platform fee in V1
			ValidBefore:         validBefore,
			// MerchantPayToAddress, Network, Scheme, PaymentSignatureB64
			// all left as "" — the DB CHECKs enforce NULL on sangria_native rows.
		})
		if errors.Is(err, dbengine.ErrInsufficientOperatorBalance) {
			// Leave the order in awaiting_confirmation so the operator can
			// top up and retry within the quote TTL.
			return c.Status(fiber.StatusPaymentRequired).JSON(errorJSON("insufficient_balance"))
		}
		if errors.Is(err, dbengine.ErrAgentOperatorNotFound) {
			slog.Error("operator not found at confirm — middleware should have rejected", "operator_id", operator.ID)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("internal_error"))
		}
		if err != nil {
			slog.Error("create agent payment", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("payment_create_failed"))
		}

		// 9. Race-safe ConfirmOrder. If alreadyConfirmed=true, a concurrent
		// /confirm beat us — DON'T call the merchant (the winner is/was
		// doing that). Return current state idempotently.
		confirmedOrder, alreadyConfirmed, err := dbengine.ConfirmOrder(ctx, pool, orderID, payment.ID)
		if errors.Is(err, dbengine.ErrOrderNotFound) {
			// Shouldn't happen — we read the row above. Race with manual
			// deletion is the only plausible cause.
			slog.Error("order disappeared between GetOrderByID and ConfirmOrder", "order_id", orderID)
			return c.Status(fiber.StatusNotFound).JSON(errorJSON("not_found"))
		}
		if err != nil {
			slog.Error("confirm order", "order_id", orderID, "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("order_confirm_failed"))
		}
		if alreadyConfirmed {
			return c.Status(fiber.StatusOK).JSON(serializeOrder(confirmedOrder, catalog))
		}
		order = confirmedOrder

		// 10. Call the merchant (30s budget). Failures here mean we already
		// flipped the order to running and reserved the operator's balance,
		// but the merchant didn't take the request — release the hold +
		// flip both rows to failed.
		buyURL, err := sangriamerchant.DeriveBuyURL(config.Merchant.CatalogURL, catalog.BuyEndpoint)
		if err != nil {
			slog.Error("derive buy URL", "catalog_url", config.Merchant.CatalogURL, "error", err)
			failPaymentAndOrder(ctx, pool, payment.ID, orderID, "internal_url_error", err.Error())
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("internal_error"))
		}
		var items []sangriamerchant.BuyItem
		if err := json.Unmarshal(order.LineItems, &items); err != nil {
			slog.Error("unmarshal order line_items", "order_id", orderID, "error", err)
			failPaymentAndOrder(ctx, pool, payment.ID, orderID, "internal_line_items_error", err.Error())
			return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("internal_error"))
		}
		buyCtx, buyCancel := context.WithTimeout(ctx, buyTimeout)
		defer buyCancel()
		result, err := merchantClient.Buy(buyCtx, buyURL, sangriamerchant.BuyRequest{
			Items: items,
			Email: *operator.Email,
			Phone: *operator.Phone,
			Address: sangriamerchant.BuyAddress{
				Line1:      shipping.Line1,
				Line2:      shipping.Line2,
				City:       shipping.City,
				State:      shipping.State,
				PostalCode: shipping.PostalCode,
				Country:    shipping.Country,
			},
		})
		if err != nil {
			slog.Warn("merchant Buy failed", "order_id", orderID, "buy_url", buyURL, "error", err)
			failedOrder := failPaymentAndOrder(ctx, pool, payment.ID, orderID, "merchant_call_failed", err.Error())
			return c.Status(fiber.StatusOK).JSON(buildConfirmResponse(failedOrder, "merchant_call_failed", err.Error()))
		}

		// 11. Branch on merchant response.
		switch result.Status {
		case sangriamerchant.BuyResultStatusCompleted:
			// Happy path. Atomically write the ledger entries + flip the
			// payment to confirmed via ConfirmSangriaNativePayment, then
			// flip the order to completed.
			_, err := dbengine.ConfirmSangriaNativePayment(ctx, pool, dbengine.ConfirmSangriaNativePaymentParams{
				PaymentID:                  payment.ID,
				AgentOperatorID:            operator.ID,
				SettlementAmountMicrounits: order.QuoteAmountMicrounits,
				PlatformFeeMicrounits:      0, // V1: no platform fee
				LedgerIdempotencyKey:       "payment-confirm-" + payment.ID,
			})
			if err != nil {
				// ConfirmSangriaNativePayment failed AFTER the merchant
				// accepted the order. This is the partial-write hazard
				// flagged in the "no refund" known-gap: we owe the merchant
				// but didn't debit the operator (or vice versa, depending
				// on where the failure landed). Surface loudly; manual SQL
				// reconciliation needed.
				slog.Error("ConfirmSangriaNativePayment failed AFTER merchant accepted — manual reconciliation needed",
					"order_id", orderID, "payment_id", payment.ID,
					"merchant_order_id", result.MerchantOrderID, "error", err)
				// Order stays in running; payment stays in pending; the
				// operator sees an inconsistent state. Return 500 so the
				// agent doesn't think the order succeeded.
				return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("confirm_ledger_write_failed"))
			}
			completedOrder, err := dbengine.CompleteOrder(ctx, pool, orderID, result.Result)
			if err != nil {
				slog.Error("CompleteOrder failed AFTER ledger write — manual reconciliation needed",
					"order_id", orderID, "payment_id", payment.ID, "error", err)
				return c.Status(fiber.StatusInternalServerError).JSON(errorJSON("order_complete_failed"))
			}
			return c.Status(fiber.StatusOK).JSON(ConfirmResponse{
				OrderID: completedOrder.ID,
				Status:  completedOrder.Status,
				Charged: ChargedBlock{AmountMicrounits: completedOrder.QuoteAmountMicrounits},
				Result:  completedOrder.Result,
			})

		case sangriamerchant.BuyResultStatusRunning:
			// V1 doesn't support async merchants — would leak pending-hold.
			// Fail both the payment and the order, return 501.
			failPaymentAndOrder(ctx, pool, payment.ID, orderID,
				"unsupported_async_merchant",
				"V1 does not support merchants that return status=running")
			return c.Status(fiber.StatusNotImplemented).JSON(errorJSON("unsupported_async_merchant"))

		case sangriamerchant.BuyResultStatusFailed:
			code := "merchant_failed"
			message := "merchant returned failure"
			if result.Error != nil {
				if result.Error.Code != "" {
					code = result.Error.Code
				}
				if result.Error.Message != "" {
					message = result.Error.Message
				}
			}
			failedOrder := failPaymentAndOrder(ctx, pool, payment.ID, orderID, code, message)
			return c.Status(fiber.StatusOK).JSON(buildConfirmResponse(failedOrder, code, message))

		default:
			// Unknown status — treat as failure to avoid leaking pending-hold.
			slog.Error("merchant returned unknown buy status",
				"order_id", orderID, "status", result.Status)
			failPaymentAndOrder(ctx, pool, payment.ID, orderID,
				"unknown_merchant_status",
				fmt.Sprintf("merchant returned unrecognized status %q", result.Status))
			return c.Status(fiber.StatusBadGateway).JSON(errorJSON("unknown_merchant_status"))
		}
	}
}

// fetchCatalogForResponse is a thin wrapper around merchantClient.FetchCatalog
// with the standard 10s timeout. Used by the idempotent-return path in
// step 4 (need a catalog for the merchant block in the response). Returns
// the bare error so the caller decides the HTTP status.
func fetchCatalogForResponse(ctx context.Context) (sangriamerchant.CatalogResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, catalogTimeout)
	defer cancel()
	return merchantClient.FetchCatalog(ctx, config.Merchant.CatalogURL)
}

// cancelOrderQuiet attempts to cancel an order and logs failure rather than
// returning it. Used in the validation-fail paths where the HTTP error code
// already conveys the real problem and the cancel is best-effort cleanup.
// Suppresses ErrOrderNotInExpectedState (concurrent transition already
// moved the row out of awaiting_confirmation — harmless).
func cancelOrderQuiet(ctx context.Context, pool *pgxpool.Pool, orderID string) {
	_, err := dbengine.CancelOrder(ctx, pool, orderID)
	if err == nil {
		return
	}
	if errors.Is(err, dbengine.ErrOrderNotInExpectedState) || errors.Is(err, dbengine.ErrOrderNotFound) {
		return
	}
	slog.Warn("cancel order (best-effort) failed", "order_id", orderID, "error", err)
}

// failPaymentAndOrder transitions both the payment and the order to failed
// in that order. Releases the pending-hold on the payment first (so the
// operator's balance is freed for retries even if FailOrder errors).
// Returns the order's current state for the response — best-effort, with
// the original order substituted on FailOrder failure.
func failPaymentAndOrder(ctx context.Context, pool *pgxpool.Pool, paymentID, orderID, code, message string) dbengine.Order {
	if _, err := dbengine.FailAgentPayment(ctx, pool, paymentID, code, message); err != nil {
		// ErrIntentAlreadyConfirmed means the payment somehow committed
		// before we got here — surface loudly. Other errors are operational.
		slog.Error("fail agent payment", "payment_id", paymentID, "code", code, "error", err)
	}
	failedOrder, err := dbengine.FailOrder(ctx, pool, orderID, code, message)
	if err != nil {
		slog.Error("fail order", "order_id", orderID, "code", code, "error", err)
		// Re-read to return something useful to the caller. If even that
		// fails, build a zero-value Order with at least the ID set.
		o, getErr := dbengine.GetOrderByID(ctx, pool, orderID)
		if getErr != nil {
			return dbengine.Order{ID: orderID, FailureCode: &code, FailureMessage: &message}
		}
		return o
	}
	return failedOrder
}

// buildConfirmResponse constructs the failure-flavored ConfirmResponse from
// a (possibly stale-read) order plus an explicit failure code + message.
func buildConfirmResponse(order dbengine.Order, code, message string) ConfirmResponse {
	resp := ConfirmResponse{
		OrderID: order.ID,
		Status:  order.Status,
		Charged: ChargedBlock{AmountMicrounits: 0}, // failed orders aren't charged
		Failure: &FailureBlock{Code: code, Message: message},
	}
	if order.Status == "" {
		resp.Status = dbengine.OrderStatusFailed
	}
	return resp
}
