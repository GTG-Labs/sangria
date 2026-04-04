package dbengine

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateCryptoWalletWithAccount atomically creates a USDC ASSET ledger account
// and a crypto wallet record in a single transaction. If either insert fails,
// both are rolled back so we never end up with an orphaned account or wallet.
func CreateCryptoWalletWithAccount(ctx context.Context, pool *pgxpool.Pool, address string, network Network, accountName string) (CryptoWallet, Account, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return CryptoWallet{}, Account{}, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Create the USDC ASSET ledger account.
	var a Account
	err = tx.QueryRow(ctx,
		`INSERT INTO accounts (name, type, currency)
		 VALUES ($1, $2, $3)
		 RETURNING id, name, type, currency, user_id, created_at`,
		accountName, AccountTypeAsset, USDC,
	).Scan(&a.ID, &a.Name, &a.Type, &a.Currency, &a.UserID, &a.CreatedAt)
	if err != nil {
		return CryptoWallet{}, Account{}, fmt.Errorf("create asset account: %w", err)
	}

	// Create the crypto wallet record linked to the new account.
	var w CryptoWallet
	err = tx.QueryRow(ctx,
		`INSERT INTO crypto_wallets (address, network, account_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, address, network, account_id, last_used_at, created_at`,
		address, network, a.ID,
	).Scan(&w.ID, &w.Address, &w.Network, &w.AccountID, &w.LastUsedAt, &w.CreatedAt)
	if err != nil {
		return CryptoWallet{}, Account{}, fmt.Errorf("create crypto wallet: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return CryptoWallet{}, Account{}, fmt.Errorf("commit transaction: %w", err)
	}

	return w, a, nil
}

// GetWalletByNetwork returns the wallet for the given network.
func GetWalletByNetwork(ctx context.Context, pool *pgxpool.Pool, network Network) (CryptoWallet, error) {
	var w CryptoWallet
	err := pool.QueryRow(ctx,
		`SELECT id, address, network, account_id, last_used_at, created_at
		 FROM crypto_wallets
		 WHERE network = $1
		 LIMIT 1`,
		network,
	).Scan(&w.ID, &w.Address, &w.Network, &w.AccountID, &w.LastUsedAt, &w.CreatedAt)
	return w, err
}

// GetWalletByAddress returns a wallet by its on-chain address.
// Uses case-insensitive comparison for EIP-55 checksum compatibility.
func GetWalletByAddress(ctx context.Context, pool *pgxpool.Pool, address string) (CryptoWallet, error) {
	var w CryptoWallet
	err := pool.QueryRow(ctx,
		`SELECT id, address, network, account_id, last_used_at, created_at
		 FROM crypto_wallets
		 WHERE LOWER(address) = LOWER($1)`,
		address,
	).Scan(&w.ID, &w.Address, &w.Network, &w.AccountID, &w.LastUsedAt, &w.CreatedAt)
	return w, err
}

