package x402Handlers

// PaymentRequirements specifies the terms for an x402 payment.
// Matches the x402 v2 spec: https://github.com/coinbase/x402/blob/main/go/types/v2.go
type PaymentRequirements struct {
	Scheme            string         `json:"scheme"`
	Network           string         `json:"network"`
	Asset             string         `json:"asset"`
	Amount            string         `json:"amount"`
	PayTo             string         `json:"payTo"`
	MaxTimeoutSeconds int            `json:"maxTimeoutSeconds"`
	Extra             map[string]any `json:"extra,omitempty"`
}

// ResourceInfo describes the resource being accessed.
type ResourceInfo struct {
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
}

// VerifyResponse is the response from the facilitator /verify endpoint.
type VerifyResponse struct {
	IsValid        bool   `json:"isValid"`
	InvalidReason  string `json:"invalidReason,omitempty"`
	InvalidMessage string `json:"invalidMessage,omitempty"`
	Payer          string `json:"payer,omitempty"`
}

// SettleResponse is the response from the facilitator /settle endpoint.
type SettleResponse struct {
	Success      bool   `json:"success"`
	ErrorReason  string `json:"errorReason,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
	Payer        string `json:"payer,omitempty"`
	Transaction  string `json:"transaction"`
	Network      string `json:"network"`
}

// NetworkConfig holds CAIP-2 ID and USDC contract address for a network.
type NetworkConfig struct {
	CAIP2       string
	USDCAddress string
}

// NetworkConfigs maps human-readable network names to their CAIP-2 IDs
// and USDC contract addresses.
var NetworkConfigs = map[string]NetworkConfig{
	"base-sepolia": {CAIP2: "eip155:84532", USDCAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"},
	"base":         {CAIP2: "eip155:8453", USDCAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},
	"polygon":      {CAIP2: "eip155:137", USDCAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"},
	"solana":        {CAIP2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", USDCAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},
	"solana-devnet": {CAIP2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", USDCAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"},
}
