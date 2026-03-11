// Package dbengine contains Go structs that mirror the Drizzle schema
// defined in drizzleSchema/. The TypeScript schema is the source of truth.
package dbengine

import "time"

// Helper functions for nullable WorkosID
func StringPtr(s string) *string {
	return &s
}

func SafeWorkosID(workosID *string) string {
	if workosID == nil {
		return ""
	}
	return *workosID
}

type Account struct {
	ID            int64     `json:"id"`
	AccountNumber string    `json:"account_number"`
	Owner         string    `json:"owner"`
	WorkosID      *string   `json:"workos_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Transaction struct {
	ID          int64     `json:"id"`
	FromAccount int64     `json:"from_account"`
	ToAccount   int64     `json:"to_account"`
	Value       string    `json:"value"`
	CreatedAt   time.Time `json:"created_at"`
}
