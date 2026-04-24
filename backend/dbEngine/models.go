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

type Organization struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	IsPersonal bool      `json:"is_personal"`
	CreatedAt  time.Time `json:"created_at"`
}

type Account struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Type           AccountType `json:"type"`
	Currency       Currency    `json:"currency"`
	OrganizationID *string     `json:"organization_id"`
	CreatedAt      time.Time   `json:"created_at"`
}

type User struct {
	WorkosID  string    `json:"workos_id"`
	Owner     string    `json:"owner"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OrganizationMember struct {
	UserID         string    `json:"user_id"`
	OrganizationID string    `json:"organization_id"`
	IsAdmin        bool      `json:"is_admin"`
	JoinedAt       time.Time `json:"joined_at"`
	DisplayName    string    `json:"display_name"` // Contains the display name (FirstName LastName) or email as fallback
	Email          string    `json:"email,omitempty"` // The email address from WorkOS
}

// UserOrganization represents a user's membership in an organization with org details included.
type UserOrganization struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsPersonal bool   `json:"is_personal"`
	IsAdmin    bool   `json:"is_admin"`
}

type InvitationStatus string

const (
	InvitationStatusPending  InvitationStatus = "pending"
	InvitationStatusAccepted InvitationStatus = "accepted"
	InvitationStatusDeclined InvitationStatus = "declined"
	InvitationStatusExpired  InvitationStatus = "expired"
)

type OrganizationInvitation struct {
	ID              string            `json:"id"`
	OrganizationID  string            `json:"organization_id"`
	InviterUserID   string            `json:"inviter_user_id"`
	InviteeEmail    string            `json:"invitee_email"`
	InviteeUserID   *string           `json:"invitee_user_id"`
	Status          InvitationStatus  `json:"status"`
	Message         *string           `json:"message"`
	InvitationToken string            `json:"invitation_token"`
	ExpiresAt       time.Time         `json:"expires_at"`
	CreatedAt       time.Time         `json:"created_at"`
	AcceptedAt      *time.Time        `json:"accepted_at"`
	DeclinedAt      *time.Time        `json:"declined_at"`
}

type TransactionStatus string

const (
	TransactionStatusPending   TransactionStatus = "pending"
	TransactionStatusConfirmed TransactionStatus = "confirmed"
	TransactionStatusFailed    TransactionStatus = "failed"
)

type Transaction struct {
	ID             string            `json:"id"`
	IdempotencyKey string            `json:"idempotency_key"`
	Status         TransactionStatus `json:"status"`
	TxHash         *string           `json:"tx_hash"`
	CreatedAt      time.Time         `json:"created_at"`
}

type LedgerEntry struct {
	ID            string    `json:"id"`
	TransactionID string    `json:"transaction_id"`
	Currency      Currency  `json:"currency"`
	Amount        int64     `json:"amount"`
	Direction     Direction `json:"direction"`
	AccountID     string    `json:"account_id"`
}

// AdminLedgerEntry is a ledger entry enriched with account details for admin views.
type AdminLedgerEntry struct {
	ID          string      `json:"id"`
	Amount      int64       `json:"amount"`
	Direction   Direction   `json:"direction"`
	Currency    Currency    `json:"currency"`
	AccountName string      `json:"account_name"`
	AccountType AccountType `json:"account_type"`
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
	NetworkBase         Network = "base"            // eip155:8453
	NetworkBaseSepolia  Network = "base-sepolia"    // eip155:84532
	NetworkPolygon      Network = "polygon"         // eip155:137
	NetworkSolana       Network = "solana"          // solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
	NetworkSolanaDevnet Network = "solana-devnet"   // solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
)

type APIKeyStatus string

const (
	APIKeyStatusActive   APIKeyStatus = "active"   // Approved and working
	APIKeyStatusPending  APIKeyStatus = "pending"  // Awaiting admin approval
	APIKeyStatusInactive APIKeyStatus = "inactive" // Rejected or revoked
)

type Merchant struct {
	ID             string       `json:"id"`
	OrganizationID string       `json:"organization_id"`
	APIKey         string       `json:"api_key"`
	KeyID          string       `json:"key_id"`
	Name           string       `json:"name"`
	Status         APIKeyStatus `json:"status"`
	LastUsedAt     *time.Time   `json:"last_used_at"`
	CreatedAt      time.Time    `json:"created_at"`
}

// MerchantPublic represents a merchant API key without exposing the hashed key
type MerchantPublic struct {
	ID             string       `json:"id"`
	OrganizationID string       `json:"organization_id"`
	KeyID          string       `json:"key_id"`
	Name           string       `json:"name"`
	Status         APIKeyStatus `json:"status"`
	LastUsedAt     *time.Time   `json:"last_used_at"`
	CreatedAt      time.Time    `json:"created_at"`
}

type CryptoWallet struct {
	ID         string    `json:"id"`
	Address    string    `json:"address"`
	Network    Network   `json:"network"`
	AccountID  string    `json:"account_id"`
	LastUsedAt time.Time `json:"last_used_at"`
	CreatedAt  time.Time `json:"created_at"`
}

// MerchantTransaction represents a transaction with enriched data for API responses.
type MerchantTransaction struct {
	ID             string    `json:"id"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
	Amount         int64     `json:"amount"`
	Currency       Currency  `json:"currency"`
	Type           string    `json:"type"`
}

// PaginationMeta holds pagination metadata for API responses
type PaginationMeta struct {
	NextCursor *string `json:"next_cursor"` // Base64-encoded cursor, nil if no more
	HasMore    bool    `json:"has_more"`    // True if more results exist
	Count      int     `json:"count"`       // Items in this response
	Limit      int     `json:"limit"`       // Requested page size
	Total      int     `json:"total"`       // Total count of all transactions
}

// TransactionsResponse wraps transaction data with pagination metadata
type TransactionsResponse struct {
	Data       []MerchantTransaction `json:"data"`
	Pagination PaginationMeta        `json:"pagination"`
}

// AdminTransaction represents a transaction enriched with organization and fee data.
type AdminTransaction struct {
	ID               string    `json:"id"`
	IdempotencyKey   string    `json:"idempotency_key"`
	CreatedAt        time.Time `json:"created_at"`
	MerchantName     string    `json:"merchant_name"`      // organization name
	MerchantID       string    `json:"merchant_id"`        // organization id
	Amount           int64     `json:"amount"`             // merchant received (microunits)
	Fee              int64     `json:"fee"`                // platform fee (microunits)
	Total            int64     `json:"total"`              // amount + fee
	Currency         Currency  `json:"currency"`
}

// AdminTransactionsResponse wraps enriched admin transactions with pagination and totals.
type AdminTransactionsResponse struct {
	Data       []AdminTransaction `json:"data"`
	Pagination PaginationMeta     `json:"pagination"`
	Totals     *AdminTotals       `json:"totals,omitempty"`
}

// AdminTotals holds aggregate metrics across all transactions.
type AdminTotals struct {
	TransactionCount int   `json:"transaction_count"`
	TotalVolume      int64 `json:"total_volume"`      // sum of all payments (microunits)
	TotalFees        int64 `json:"total_fees"`         // sum of platform fees (microunits)
	MerchantCount    int   `json:"merchant_count"`     // distinct merchants
}

// WithdrawalsResponse wraps withdrawal data with pagination metadata
type WithdrawalsResponse struct {
	Data       []Withdrawal   `json:"data"`
	Pagination PaginationMeta `json:"pagination"`
}

type WithdrawalStatus string

const (
	WithdrawalStatusPendingApproval WithdrawalStatus = "pending_approval"
	WithdrawalStatusApproved        WithdrawalStatus = "approved"
	WithdrawalStatusProcessing      WithdrawalStatus = "processing"
	WithdrawalStatusCompleted       WithdrawalStatus = "completed"
	WithdrawalStatusFailed          WithdrawalStatus = "failed"
	WithdrawalStatusReversed        WithdrawalStatus = "reversed"
	WithdrawalStatusCanceled        WithdrawalStatus = "canceled"
)

type Withdrawal struct {
	ID                      string           `json:"id"`
	MerchantID              string           `json:"merchant_id"`
	Amount                  int64            `json:"amount"`
	Fee                     int64            `json:"fee"`
	NetAmount               int64            `json:"net_amount"`
	Status                  WithdrawalStatus `json:"status"`
	DebitTransactionID      *string          `json:"debit_transaction_id"`
	CompletionTransactionID *string          `json:"completion_transaction_id"`
	ReversalTransactionID   *string          `json:"reversal_transaction_id"`
	FailureCode             *string          `json:"failure_code"`
	FailureMessage          *string          `json:"failure_message"`
	ReviewedBy              *string          `json:"reviewed_by"`
	ReviewedAt              *time.Time       `json:"reviewed_at"`
	ReviewNote              *string          `json:"review_note"`
	CompletedBy             *string          `json:"completed_by"`
	FailedBy                *string          `json:"failed_by"`
	// Internal dedup key for merchant retries on POST /withdrawals — scanned from
	// the DB so idempotent replays can short-circuit, but never serialized to
	// clients. `json:"-"` hides it from all HTTP responses (merchant + admin).
	IdempotencyKey          string           `json:"-"`
	CreatedAt               time.Time        `json:"created_at"`
	ApprovedAt              *time.Time       `json:"approved_at"`
	ProcessedAt             *time.Time       `json:"processed_at"`
	CompletedAt             *time.Time       `json:"completed_at"`
	FailedAt                *time.Time       `json:"failed_at"`
	ReversedAt              *time.Time       `json:"reversed_at"`
	CanceledAt              *time.Time       `json:"canceled_at"`
}

// ---------------------------------------------------------------------------
// Request Management Types
// ---------------------------------------------------------------------------

type RequestStatus string

const (
	RequestStatusPending  RequestStatus = "pending"
	RequestStatusApproved RequestStatus = "approved"
	RequestStatusRejected RequestStatus = "rejected"
	RequestStatusCanceled RequestStatus = "canceled"
)


