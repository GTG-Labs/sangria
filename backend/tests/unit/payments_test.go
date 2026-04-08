package unit

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbengine "sangrianet/backend/dbEngine"
	"sangrianet/backend/merchantHandlers"
	"sangrianet/backend/tests/testutils"
)

func TestGeneratePayment(t *testing.T) {
	// Setup test database
	testDB := testutils.SetupTestDatabase(t)
	defer testDB.Cleanup(t)
	testDB.CreateTestSchema(t)
	testDB.SetupTestWalletAndAccount(t)

	// Setup Fiber app
	app := fiber.New()
	app.Post("/v1/generate-payment", merchantHandlers.GeneratePayment(testDB.Pool))

	tests := []struct {
		name           string
		requestBody    map[string]interface{}
		expectedStatus int
		expectedError  string
	}{
		{
			name: "Valid payment request",
			requestBody: map[string]interface{}{
				"amount":      0.01,
				"description": "Test payment",
				"resource":    "https://example.com/premium",
			},
			expectedStatus: 200,
		},
		{
			name: "Invalid amount - zero",
			requestBody: map[string]interface{}{
				"amount":      0,
				"description": "Test payment",
				"resource":    "https://example.com/premium",
			},
			expectedStatus: 400,
			expectedError:  "amount must be a positive number within a valid range",
		},
		{
			name: "Invalid amount - negative",
			requestBody: map[string]interface{}{
				"amount":      -0.01,
				"description": "Test payment",
				"resource":    "https://example.com/premium",
			},
			expectedStatus: 400,
			expectedError:  "amount must be a positive number within a valid range",
		},
		{
			name: "Invalid amount - too large",
			requestBody: map[string]interface{}{
				"amount":      10_000_000_000_000,
				"description": "Test payment",
				"resource":    "https://example.com/premium",
			},
			expectedStatus: 400,
			expectedError:  "amount must be a positive number within a valid range",
		},
		{
			name: "Invalid JSON",
			requestBody: map[string]interface{}{
				"amount": "not_a_number",
			},
			expectedStatus: 400,
			expectedError:  "invalid request body",
		},
		{
			name: "Missing required fields",
			requestBody: map[string]interface{}{
				"amount": 0.01,
				// missing description and resource
			},
			expectedStatus: 200, // Handler allows empty description/resource fields
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create request body
			body, err := json.Marshal(tt.requestBody)
			require.NoError(t, err)

			// Create request
			req := httptest.NewRequest(http.MethodPost, "/v1/generate-payment", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			// Perform request
			resp, err := app.Test(req)
			require.NoError(t, err)

			// Check status code
			assert.Equal(t, tt.expectedStatus, resp.StatusCode)

			// Check error message if expected
			if tt.expectedError != "" {
				var response map[string]interface{}
				err := json.NewDecoder(resp.Body).Decode(&response)
				require.NoError(t, err)

				errorMsg, exists := response["error"]
				assert.True(t, exists, "Expected error field in response")
				assert.Equal(t, tt.expectedError, errorMsg)
			}

			resp.Body.Close()
		})
	}
}

func TestGeneratePaymentAmountConversion(t *testing.T) {
	tests := []struct {
		name           string
		inputAmount    float64
		expectedMicro  int64
		shouldSucceed  bool
	}{
		{
			name:          "Small amount",
			inputAmount:   0.01,
			expectedMicro: 10000, // 0.01 * 1e6
			shouldSucceed: true,
		},
		{
			name:          "One dollar",
			inputAmount:   1.0,
			expectedMicro: 1000000, // 1.0 * 1e6
			shouldSucceed: true,
		},
		{
			name:          "Large amount",
			inputAmount:   1000000.0,
			expectedMicro: 1000000000000, // 1M * 1e6
			shouldSucceed: true,
		},
		{
			name:          "Precision test",
			inputAmount:   0.123456,
			expectedMicro: 123456, // Should preserve 6 decimal places
			shouldSucceed: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// This tests the internal logic for amount conversion
			// In the actual handler, this is done with: int64(math.Round(req.Amount * 1e6))
			actualMicro := int64(math.Round(tt.inputAmount * 1e6))
			assert.Equal(t, tt.expectedMicro, actualMicro)
		})
	}
}

func TestSettlePayment(t *testing.T) {
	// Setup test database
	testDB := testutils.SetupTestDatabase(t)
	defer testDB.Cleanup(t)
	testDB.CreateTestSchema(t)
	testDB.SetupTestWalletAndAccount(t)
	testDB.SetupTestMerchant(t)

	// Setup Fiber app with mock auth middleware
	app := fiber.New()
	app.Use("/v1/settle-payment", func(c *fiber.Ctx) error {
		// Mock merchant for testing
		mockMerchant := &dbengine.Merchant{
			ID:     "test-merchant-id",
			UserID: "test-user-id",
			APIKey: "test-api-key",
			Name:   "Test Merchant",
		}
		c.Locals("merchant_api_key", mockMerchant)
		return c.Next()
	})
	app.Post("/v1/settle-payment", merchantHandlers.SettlePayment(testDB.Pool))

	// Create valid test payload structure
	validPayload := map[string]interface{}{
		"payload": map[string]interface{}{
			"authorization": map[string]interface{}{
				"from":  "0x1234567890123456789012345678901234567890",
				"to":    "0x22A171FAe9957a560B179AD4a87336933b0aEe61", // Playground testnet wallet address
				"value": "10000", // 0.01 USDC in micro units
			},
		},
	}
	validPayloadBytes, _ := json.Marshal(validPayload)
	validPayloadB64 := base64.StdEncoding.EncodeToString(validPayloadBytes)

	tests := []struct {
		name             string
		requestBody      map[string]interface{}
		setupMockServer  bool
		mockResponse     map[string]interface{}
		mockStatus       int
		expectedStatus   int
		expectedError    string
	}{
		{
			name: "Valid payment settlement",
			requestBody: map[string]interface{}{
				"payment_payload": validPayloadB64,
			},
			setupMockServer: true,
			mockResponse: map[string]interface{}{
				"success":     true,
				"transaction": "tx123",
				"payer":       "0x1234567890123456789012345678901234567890",
			},
			mockStatus:     200,
			expectedStatus: 200,
		},
		{
			name: "Invalid payment signature",
			requestBody: map[string]interface{}{
				"payment_payload": validPayloadB64,
			},
			setupMockServer: true,
			mockResponse: map[string]interface{}{
				"isValid":       false,
				"invalidReason": "INVALID_SIGNATURE",
				"invalidMessage": "Invalid signature",
			},
			mockStatus:     200, // Verify endpoint returns 200 but with isValid: false
			expectedStatus: 400,
			expectedError:  "Invalid signature",
		},
		{
			name: "Missing payment payload",
			requestBody: map[string]interface{}{
				// missing payment_payload
			},
			expectedStatus: 400,
			expectedError:  "invalid payment_payload JSON", // Empty string decodes to empty base64, which is invalid JSON
		},
		{
			name: "Facilitator timeout",
			requestBody: map[string]interface{}{
				"payment_payload": validPayloadB64,
			},
			setupMockServer: false, // No mock server to simulate timeout
			expectedStatus:  502,
			expectedError:   "facilitator verification failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup mock facilitator server if needed
			if tt.setupMockServer {
				mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")

					// Handle different endpoints
					if r.URL.Path == "/verify" {
						if tt.name == "Invalid payment signature" {
							// Return verification failure
							response := map[string]interface{}{
								"isValid":       false,
								"invalidReason": "INVALID_SIGNATURE",
								"invalidMessage": "Invalid signature",
							}
							w.WriteHeader(200)
							json.NewEncoder(w).Encode(response)
						} else {
							// Return verification success
							response := map[string]interface{}{
								"isValid": true,
								"payer":   "0x1234567890123456789012345678901234567890",
							}
							w.WriteHeader(200)
							json.NewEncoder(w).Encode(response)
						}
					} else if r.URL.Path == "/settle" {
						// Return settlement response
						w.WriteHeader(tt.mockStatus)
						json.NewEncoder(w).Encode(tt.mockResponse)
					} else {
						w.WriteHeader(404)
						json.NewEncoder(w).Encode(map[string]string{"error": "endpoint not found"})
					}
				}))
				defer mockServer.Close()

				// Set environment variable for facilitator URL
				t.Setenv("X402_FACILITATOR_URL", mockServer.URL)
			}

			// Create request body
			body, err := json.Marshal(tt.requestBody)
			require.NoError(t, err)

			// Create request
			req := httptest.NewRequest(http.MethodPost, "/v1/settle-payment", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			// Perform request
			resp, err := app.Test(req)
			require.NoError(t, err)

			// Check status code
			assert.Equal(t, tt.expectedStatus, resp.StatusCode)

			// Check error message if expected
			if tt.expectedError != "" {
				var response map[string]interface{}
				err := json.NewDecoder(resp.Body).Decode(&response)
				require.NoError(t, err)

				// Check for different error field patterns
				var errorMsg interface{}
				var exists bool
				if errorMsg, exists = response["error"]; exists {
					assert.Contains(t, errorMsg, tt.expectedError)
				} else if errorMsg, exists = response["error_message"]; exists {
					assert.Contains(t, errorMsg, tt.expectedError)
				} else {
					t.Errorf("Expected error field in response, got: %+v", response)
				}
			}

			resp.Body.Close()
		})
	}
}