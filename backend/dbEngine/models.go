// Package dbengine contains Go structs that mirror the Drizzle schema
// defined in dbSchema/. The TypeScript schema is the source of truth.
package dbengine

import "time"

type Direction string

const (
	Debit  Direction = "DEBIT"
	Credit Direction = "CREDIT"
)

type Currency string

const (
	USD  Currency = "USD"
	USDC Currency = "USDC"
	ETH  Currency = "ETH"
)

type AccountType string

const (
	AccountTypeAsset     AccountType = "ASSET"
	AccountTypeLiability AccountType = "LIABILITY"
	AccountTypeEquity    AccountType = "EQUITY"
	AccountTypeRevenue   AccountType = "REVENUE"
	AccountTypeExpense   AccountType = "EXPENSE"
)

type Account struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Type      AccountType `json:"type"`
	Currency  Currency    `json:"currency"`
	UserID    *string     `json:"user_id"`
	CreatedAt time.Time   `json:"created_at"`
}

type User struct {
	WorkosID  string    `json:"workos_id"`
	Owner     string    `json:"owner"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Transaction struct {
	ID             string    `json:"id"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

type LedgerEntry struct {
	ID            string    `json:"id"`
	TransactionID string    `json:"transaction_id"`
	Currency      Currency  `json:"currency"`
	Amount        int64     `json:"amount"`
	Direction     Direction `json:"direction"`
	AccountID     string    `json:"account_id"`
}

// LedgerLine is an input struct used when building entries to insert.
type LedgerLine struct {
	Currency  Currency  `json:"currency"`
	Amount    int64     `json:"amount"`
	Direction Direction `json:"direction"`
	AccountID string    `json:"account_id"`
}

// ---------------------------------------------------------------------------
// x402 types
// ---------------------------------------------------------------------------

type Network string

const (
	NetworkBase         Network = "base"           // eip155:8453
	NetworkBaseSepolia  Network = "base-sepolia"   // eip155:84532
	NetworkPolygon      Network = "polygon"        // eip155:137
	NetworkSolana       Network = "solana"          // solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
	NetworkSolanaDevnet Network = "solana-devnet"   // solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
)

type PaymentStatus string

const (
	PaymentStatusPending PaymentStatus = "pending"
	PaymentStatusSettled PaymentStatus = "settled"
	PaymentStatusFailed  PaymentStatus = "failed"
	PaymentStatusExpired PaymentStatus = "expired"
)

type Card struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	ApiKey     string     `json:"api_key"`
	KeyID      string     `json:"key_id"`
	Name       string     `json:"name"`
	IsActive   bool       `json:"is_active"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type Merchant struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	APIKey     string     `json:"api_key"`
	KeyID      string     `json:"key_id"`
	Name       string     `json:"name"`
	IsActive   bool       `json:"is_active"`
	LastUsedAt *time.Time `json:"last_used_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type CryptoWallet struct {
	ID         string    `json:"id"`
	Address    string    `json:"address"`
	Network    Network   `json:"network"`
	AccountID  string    `json:"account_id"`
	LastUsedAt time.Time `json:"last_used_at"`
	CreatedAt  time.Time `json:"created_at"`
}

type Payment struct {
	ID               string        `json:"id"`
	MerchantID       string        `json:"merchant_id"`
	CryptoWalletID   string        `json:"crypto_wallet_id"`
	Amount           int64         `json:"amount"`
	Network          Network       `json:"network"`
	Status           PaymentStatus `json:"status"`
	SettlementTxHash *string       `json:"settlement_tx_hash"`
	PayerAddress     *string       `json:"payer_address"`
	IdempotencyKey   string        `json:"idempotency_key"`
	ExpiresAt        time.Time     `json:"expires_at"`
	CreatedAt        time.Time     `json:"created_at"`
	SettledAt        *time.Time    `json:"settled_at"`
}
