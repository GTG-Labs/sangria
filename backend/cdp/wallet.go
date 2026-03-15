package cdp

import (
	"context"
	"fmt"
	"os"
	"sync"

	cdpsdk "github.com/coinbase/cdp-sdk/go"
	"github.com/coinbase/cdp-sdk/go/openapi"
)

var (
	client *openapi.ClientWithResponses
	once   sync.Once
	initErr error
)

// GetClient returns the singleton CDP client. Thread-safe via sync.Once.
// Requires CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET env vars.
func GetClient() (*openapi.ClientWithResponses, error) {
	once.Do(func() {
		client, initErr = cdpsdk.NewClient(cdpsdk.ClientOptions{
			APIKeyID:     os.Getenv("CDP_API_KEY_ID"),
			APIKeySecret: os.Getenv("CDP_API_KEY_SECRET"),
			WalletSecret: os.Getenv("CDP_WALLET_SECRET"),
		})
	})
	return client, initErr
}

// CreateEvmAccount creates a new EVM account on CDP and returns the on-chain address.
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
		return "", fmt.Errorf("create evm account: unexpected status %d", resp.StatusCode())
	}

	return resp.JSON201.Address, nil
}

// FundETH requests testnet ETH from the faucet for gas fees.
func FundETH(ctx context.Context, address, network string) error {
	c, err := GetClient()
	if err != nil {
		return fmt.Errorf("get cdp client: %w", err)
	}

	resp, err := c.RequestEvmFaucetWithResponse(ctx, openapi.RequestEvmFaucetJSONRequestBody{
		Address: address,
		Network: openapi.RequestEvmFaucetJSONBodyNetwork(network),
		Token:   openapi.RequestEvmFaucetJSONBodyToken("eth"),
	})
	if err != nil {
		return fmt.Errorf("fund eth: %w", err)
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("fund eth: unexpected status %d", resp.StatusCode())
	}

	return nil
}

// FundUSDC requests testnet USDC from the faucet.
func FundUSDC(ctx context.Context, address, network string) error {
	c, err := GetClient()
	if err != nil {
		return fmt.Errorf("get cdp client: %w", err)
	}

	resp, err := c.RequestEvmFaucetWithResponse(ctx, openapi.RequestEvmFaucetJSONRequestBody{
		Address: address,
		Network: openapi.RequestEvmFaucetJSONBodyNetwork(network),
		Token:   openapi.RequestEvmFaucetJSONBodyToken("usdc"),
	})
	if err != nil {
		return fmt.Errorf("fund usdc: %w", err)
	}
	if resp.StatusCode() != 200 {
		return fmt.Errorf("fund usdc: unexpected status %d", resp.StatusCode())
	}

	return nil
}
