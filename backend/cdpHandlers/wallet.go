// TODO: Research into the different kinds of accounts: pros and cons (EOA vs Smart Account).
// See guides-and-knowledge/cdp-account-types.md
package cdpHandlers

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	cdpsdk "github.com/coinbase/cdp-sdk/go"
	"github.com/coinbase/cdp-sdk/go/openapi"

	"sangria/backend/config"
)

var (
	client  *openapi.ClientWithResponses
	once    sync.Once
	initErr error
)

// GetClient returns the singleton CDP client. Thread-safe via sync.Once.
// Credentials are validated at startup via config.LoadCDPConfig.
func GetClient() (*openapi.ClientWithResponses, error) {
	once.Do(func() {
		client, initErr = cdpsdk.NewClient(cdpsdk.ClientOptions{
			APIKeyID:     config.CDP.APIKey,
			APIKeySecret: config.CDP.APISecret,
			WalletSecret: config.CDP.WalletSecret,
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
		slog.Debug("CDP create evm account non-201 response", "status", resp.StatusCode(), "body", string(resp.Body))
		return "", fmt.Errorf("create evm account: unexpected status %d", resp.StatusCode())
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
		slog.Debug("CDP faucet non-200 response", "token", token, "status", resp.StatusCode(), "body", string(resp.Body))
		return fmt.Errorf("fund %s: unexpected status %d", token, resp.StatusCode())
	}

	return nil
}

// FundETH requests testnet ETH from the faucet for gas fees.
func FundETH(ctx context.Context, address, network string) error {
	return requestFaucet(ctx, address, network, "eth")
}

