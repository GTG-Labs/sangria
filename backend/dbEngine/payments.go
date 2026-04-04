package dbengine

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreatePayment inserts a new payment record with status=pending.
func CreatePayment(ctx context.Context, pool *pgxpool.Pool, merchantID, cryptoWalletID string, amount int64, network Network, idempotencyKey string, expiresAt time.Time) (Payment, error) {
	var p Payment
	err := pool.QueryRow(ctx,
		`INSERT INTO payments (merchant_id, crypto_wallet_id, amount, network, idempotency_key, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, merchant_id, crypto_wallet_id, amount, network, status,
		           settlement_tx_hash, payer_address, idempotency_key,
		           expires_at, created_at, settled_at`,
		merchantID, cryptoWalletID, amount, network, idempotencyKey, expiresAt,
	).Scan(
		&p.ID, &p.MerchantID, &p.CryptoWalletID, &p.Amount, &p.Network, &p.Status,
		&p.SettlementTxHash, &p.PayerAddress, &p.IdempotencyKey,
		&p.ExpiresAt, &p.CreatedAt, &p.SettledAt,
	)
	return p, err
}

// ClaimPendingPayment atomically selects and locks a pending payment using
// SELECT ... FOR UPDATE. If the payment is not pending (already settled, failed,
// or expired), or doesn't exist, it returns an error. This prevents concurrent
// requests from both starting facilitator calls for the same payment.
func ClaimPendingPayment(ctx context.Context, pool *pgxpool.Pool, id string) (Payment, func(), error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Payment{}, nil, fmt.Errorf("begin transaction: %w", err)
	}

	var p Payment
	err = tx.QueryRow(ctx,
		`SELECT id, merchant_id, crypto_wallet_id, amount, network, status,
		        settlement_tx_hash, payer_address, idempotency_key,
		        expires_at, created_at, settled_at
		 FROM payments
		 WHERE id = $1 AND status = 'pending'
		 FOR UPDATE SKIP LOCKED`,
		id,
	).Scan(
		&p.ID, &p.MerchantID, &p.CryptoWalletID, &p.Amount, &p.Network, &p.Status,
		&p.SettlementTxHash, &p.PayerAddress, &p.IdempotencyKey,
		&p.ExpiresAt, &p.CreatedAt, &p.SettledAt,
	)
	if err != nil {
		tx.Rollback(ctx)
		return Payment{}, nil, err
	}

	// Return a release function that the caller must defer to release the lock.
	release := func() { tx.Rollback(ctx) }
	return p, release, nil
}

// GetPaymentByID returns a payment by its UUID.
func GetPaymentByID(ctx context.Context, pool *pgxpool.Pool, id string) (Payment, error) {
	var p Payment
	err := pool.QueryRow(ctx,
		`SELECT id, merchant_id, crypto_wallet_id, amount, network, status,
		        settlement_tx_hash, payer_address, idempotency_key,
		        expires_at, created_at, settled_at
		 FROM payments WHERE id = $1`,
		id,
	).Scan(
		&p.ID, &p.MerchantID, &p.CryptoWalletID, &p.Amount, &p.Network, &p.Status,
		&p.SettlementTxHash, &p.PayerAddress, &p.IdempotencyKey,
		&p.ExpiresAt, &p.CreatedAt, &p.SettledAt,
	)
	return p, err
}

// UpdatePaymentSettled marks a payment as settled with the on-chain tx hash,
// payer address, and settled timestamp.
func UpdatePaymentSettled(ctx context.Context, pool *pgxpool.Pool, id, txHash, payerAddress string) error {
	result, err := pool.Exec(ctx,
		`UPDATE payments
		 SET status = $1, settlement_tx_hash = $2, payer_address = $3, settled_at = NOW()
		 WHERE id = $4 AND status = 'pending'`,
		PaymentStatusSettled, txHash, payerAddress, id,
	)
	if err != nil {
		return fmt.Errorf("update payment settled: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("payment %s is not pending", id)
	}
	return nil
}

// UpdatePaymentFailed marks a payment as failed.
func UpdatePaymentFailed(ctx context.Context, pool *pgxpool.Pool, id string) error {
	result, err := pool.Exec(ctx,
		`UPDATE payments SET status = $1 WHERE id = $2 AND status = 'pending'`,
		PaymentStatusFailed, id,
	)
	if err != nil {
		return fmt.Errorf("update payment failed: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("payment %s is not pending", id)
	}
	return nil
}

// UpdatePaymentExpired marks a payment as expired.
func UpdatePaymentExpired(ctx context.Context, pool *pgxpool.Pool, id string) error {
	result, err := pool.Exec(ctx,
		`UPDATE payments SET status = $1 WHERE id = $2 AND status = 'pending'`,
		PaymentStatusExpired, id,
	)
	if err != nil {
		return fmt.Errorf("update payment expired: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("payment %s is not pending", id)
	}
	return nil
}

// IsPaymentExpired checks if a payment has passed its expiry time.
func IsPaymentExpired(p Payment) bool {
	return time.Now().After(p.ExpiresAt)
}
