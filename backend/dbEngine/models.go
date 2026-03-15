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
