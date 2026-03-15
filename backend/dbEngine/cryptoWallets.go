package dbengine

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateCryptoWallet inserts a new wallet into the pool.
func CreateCryptoWallet(ctx context.Context, pool *pgxpool.Pool, address string, network Network, accountID string) (CryptoWallet, error) {
	var w CryptoWallet
	err := pool.QueryRow(ctx,
		`INSERT INTO crypto_wallets (address, network, account_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, address, network, account_id, last_used_at, created_at`,
		address, network, accountID,
	).Scan(&w.ID, &w.Address, &w.Network, &w.AccountID, &w.LastUsedAt, &w.CreatedAt)
	return w, err
}

// SelectLRUWallet picks the least-recently-used wallet on the given network
// and updates its last_used_at timestamp. Uses SELECT ... FOR UPDATE to
// prevent two concurrent requests from picking the same wallet.
func SelectLRUWallet(ctx context.Context, pool *pgxpool.Pool, network Network) (CryptoWallet, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return CryptoWallet{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var w CryptoWallet
	err = tx.QueryRow(ctx,
		`SELECT id, address, network, account_id, last_used_at, created_at
		 FROM crypto_wallets
		 WHERE network = $1
		 ORDER BY last_used_at ASC
		 LIMIT 1
		 FOR UPDATE SKIP LOCKED`,
		network,
	).Scan(&w.ID, &w.Address, &w.Network, &w.AccountID, &w.LastUsedAt, &w.CreatedAt)
	if err != nil {
		return CryptoWallet{}, fmt.Errorf("select lru wallet: %w", err)
	}

	_, err = tx.Exec(ctx,
		`UPDATE crypto_wallets SET last_used_at = NOW() WHERE id = $1`,
		w.ID,
	)
	if err != nil {
		return CryptoWallet{}, fmt.Errorf("update last_used_at: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return CryptoWallet{}, fmt.Errorf("commit transaction: %w", err)
	}

	return w, nil
}

// GetCryptoWalletByID returns a crypto wallet by its UUID.
func GetCryptoWalletByID(ctx context.Context, pool *pgxpool.Pool, id string) (CryptoWallet, error) {
	var w CryptoWallet
	err := pool.QueryRow(ctx,
		`SELECT id, address, network, account_id, last_used_at, created_at
		 FROM crypto_wallets WHERE id = $1`,
		id,
	).Scan(&w.ID, &w.Address, &w.Network, &w.AccountID, &w.LastUsedAt, &w.CreatedAt)
	return w, err
}
