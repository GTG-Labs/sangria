// Package dbengine contains Go structs that mirror the Drizzle schema
// defined in dbSchema/. The TypeScript schema is the source of truth.
package dbengine

import "time"

type Direction string

const (
	Debit  Direction = "DEBIT"
	Credit Direction = "CREDIT"
)

type Asset struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Currency  string    `json:"currency"`
	CreatedAt time.Time `json:"created_at"`
}

type Liability struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Currency  string    `json:"currency"`
	UserID    string    `json:"user_id"`
	CreatedAt time.Time `json:"created_at"`
}

type Expense struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Currency  string    `json:"currency"`
	CreatedAt time.Time `json:"created_at"`
}

type Revenue struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Currency  string    `json:"currency"`
	CreatedAt time.Time `json:"created_at"`
}

type LedgerEntry struct {
	ID            string  `json:"id"`
	TransactionID string  `json:"transaction_id"`
	Currency      string  `json:"currency"`
	Amount        int64   `json:"amount"`
	Direction     Direction `json:"direction"`
	AssetID       *string `json:"asset_id"`
	LiabilityID   *string `json:"liability_id"`
	ExpenseID     *string `json:"expense_id"`
	RevenueID     *string `json:"revenue_id"`
}

// LedgerLine is an input struct used when building entries to insert.
type LedgerLine struct {
	Currency    string  `json:"currency"`
	Amount      int64   `json:"amount"`
	Direction   string  `json:"direction"`
	AssetID     *string `json:"asset_id"`
	LiabilityID *string `json:"liability_id"`
	ExpenseID   *string `json:"expense_id"`
	RevenueID   *string `json:"revenue_id"`
}
