// TODO: Research into the different kinds of accounts: pros and cons (EOA vs Smart Account).
// See guides-and-knowledge/cdp-account-types.md
package cdpHandlers

import (
	"context"
	"fmt"
	"os"
	"sync"

	cdpsdk "github.com/coinbase/cdp-sdk/go"
	"github.com/coinbase/cdp-sdk/go/openapi"
)

var (
	client  *openapi.ClientWithResponses
	once    sync.Once
	initErr error
)

// GetClient returns the singleton CDP client. Thread-safe via sync.Once.
// Requires CDP_API_KEY, CDP_SECRET_KEY, and CDP_WALLET_SECRET env vars.
func GetClient() (*openapi.ClientWithResponses, error) {
	once.Do(func() {
		apiKeyID := os.Getenv("CDP_API_KEY")
		apiKeySecret := os.Getenv("CDP_API_SECRET")
		walletSecret := os.Getenv("CDP_WALLET_SECRET")

		if apiKeyID == "" || apiKeySecret == "" || walletSecret == "" {
			initErr = fmt.Errorf("CDP_API_KEY, CDP_API_SECRET, and CDP_WALLET_SECRET environment variables are required")
			return
		}

		client, initErr = cdpsdk.NewClient(cdpsdk.ClientOptions{
			APIKeyID:     apiKeyID,
			APIKeySecret: apiKeySecret,
			WalletSecret: walletSecret,
		})
	})
	return client, initErr
}

// CreateEvmAccount creates a new EVM account (EOA) on CDP and returns the on-chain address.
func CreateEvmAccount(ctx context.Context) (string, error) {
	c, err := GetClient()
	if err != nil {
		return "", fmt.Errorf("get cdp client: %w", err)
	}

	resp, err := c.CreateEvmAccountWithResponse(ctx, nil, openapi.CreateEvmAccountJSONRequestBody{})
	if err != nil {
		return "", fmt.Errorf("create evm account: %w", err)
	}
	if resp.StatusCode() != 201 {
		return "", fmt.Errorf("create evm account: unexpected status %d: %s", resp.StatusCode(), string(resp.Body))
	}
	if resp.JSON201 == nil {
		return "", fmt.Errorf("create evm account: empty or malformed 201 response")
	}

	return resp.JSON201.Address, nil
}

// requestFaucet requests testnet tokens from the CDP faucet.
func requestFaucet(ctx context.Context, address, network, token string) error {
	c, err := GetClient()
	if err != nil {
		return fmt.Errorf("get cdp client: %w", err)
	}

	resp, err := c.RequestEvmFaucetWithResponse(ctx, openapi.RequestEvmFaucetJSONRequestBody{
		Address: address,
		Network: openapi.RequestEvmFaucetJSONBodyNetwork(network),
		Token:   openapi.RequestEvmFaucetJSONBodyToken(token),
	})
	if err != nil {
		return fmt.Errorf("fund %s: %w", token, err)
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("fund %s: unexpected status %d: %s", token, resp.StatusCode(), string(resp.Body))
	}

	return nil
}

// FundETH requests testnet ETH from the faucet for gas fees.
func FundETH(ctx context.Context, address, network string) error {
	return requestFaucet(ctx, address, network, "eth")
}

// FundUSDC requests testnet USDC from the faucet.
func FundUSDC(ctx context.Context, address, network string) error {
	return requestFaucet(ctx, address, network, "usdc")
}
