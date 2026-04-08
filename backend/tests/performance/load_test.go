package performance

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"sangrianet/backend/merchantHandlers"
	"sangrianet/backend/tests/testutils"
)

func TestPerformanceAndLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping performance tests in short mode")
	}

	testDB := testutils.SetupTestDatabase(t)
	defer testDB.Cleanup(t)
	testDB.CreateTestSchema(t)

	app := fiber.New()
	app.Post("/v1/generate-payment", merchantHandlers.GeneratePayment(testDB.Pool))

	t.Run("Single request latency", func(t *testing.T) {
		testSingleRequestLatency(t, app)
	})

	t.Run("Concurrent request handling", func(t *testing.T) {
		testConcurrentRequestHandling(t, app)
	})

	t.Run("Memory usage under load", func(t *testing.T) {
		testMemoryUsageUnderLoad(t, app)
	})

	t.Run("Database connection pooling", func(t *testing.T) {
		testDatabaseConnectionPooling(t, app, testDB)
	})

	t.Run("Throughput measurement", func(t *testing.T) {
		testThroughputMeasurement(t, app)
	})

	t.Run("Resource cleanup", func(t *testing.T) {
		testResourceCleanup(t, app)
	})
}

func testSingleRequestLatency(t *testing.T, app *fiber.App) {
	const iterations = 100
	var totalDuration time.Duration

	body := `{"amount": 0.01, "resource": "latency-test", "description": "latency test"}`

	for i := 0; i < iterations; i++ {
		start := time.Now()

		req := httptest.NewRequest(http.MethodPost, "/v1/generate-payment", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")

		resp, err := app.Test(req)
		require.NoError(t, err)

		duration := time.Since(start)
		totalDuration += duration

		resp.Body.Close()
	}

	avgLatency := totalDuration / iterations
	t.Logf("Average request latency: %v", avgLatency)

	// Assert reasonable latency (adjust based on your requirements)
	assert.Less(t, avgLatency, 100*time.Millisecond, "Average latency should be under 100ms")
}

func testConcurrentRequestHandling(t *testing.T, app *fiber.App) {
	const (
		concurrency = 50
		requests    = 20
		timeout     = 30 * time.Second
	)

	var (
		successCount int64
		errorCount   int64
		totalLatency int64
	)

	server := httptest.NewServer(app)
	defer server.Close()

	client := &http.Client{Timeout: 10 * time.Second}

	start := time.Now()
	var wg sync.WaitGroup

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			for j := 0; j < requests; j++ {
				requestStart := time.Now()

				body := fmt.Sprintf(`{
					"amount": 0.01,
					"resource": "worker-%d-req-%d",
					"description": "concurrent test"
				}`, workerID, j)

				req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/generate-payment", strings.NewReader(body))
				if err != nil {
					atomic.AddInt64(&errorCount, 1)
					continue
				}

				req.Header.Set("Content-Type", "application/json")

				resp, err := client.Do(req)
				if err != nil {
					atomic.AddInt64(&errorCount, 1)
					continue
				}

				latency := time.Since(requestStart).Nanoseconds()
				atomic.AddInt64(&totalLatency, latency)

				if resp.StatusCode < 500 {
					atomic.AddInt64(&successCount, 1)
				} else {
					atomic.AddInt64(&errorCount, 1)
				}

				resp.Body.Close()
			}
		}(i)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// All requests completed
	case <-time.After(timeout):
		t.Fatal("Concurrent test timed out")
	}

	totalTime := time.Since(start)
	totalRequests := successCount + errorCount
	avgLatency := time.Duration(totalLatency / totalRequests)
	rps := float64(successCount) / totalTime.Seconds()

	t.Logf("Concurrent test results:")
	t.Logf("  Successes: %d", successCount)
	t.Logf("  Errors: %d", errorCount)
	t.Logf("  Average latency: %v", avgLatency)
	t.Logf("  Requests per second: %.2f", rps)

	// Assert performance requirements
	successRate := float64(successCount) / float64(totalRequests)
	assert.Greater(t, successRate, 0.95, "Success rate should be > 95%")
	assert.Greater(t, rps, 10.0, "Should handle at least 10 RPS")
	assert.Less(t, avgLatency, 500*time.Millisecond, "Average latency should be under 500ms")
}

func testMemoryUsageUnderLoad(t *testing.T, app *fiber.App) {
	runtime.GC() // Start with clean memory

	var initialStats, finalStats runtime.MemStats
	runtime.ReadMemStats(&initialStats)

	server := httptest.NewServer(app)
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}

	// Generate load
	const requests = 1000
	for i := 0; i < requests; i++ {
		body := fmt.Sprintf(`{
			"amount": 0.01,
			"resource": "memory-test-%d",
			"description": "memory test"
		}`, i)

		req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/generate-payment", strings.NewReader(body))
		if err != nil {
			continue
		}

		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		resp.Body.Close()
	}

	runtime.GC() // Force garbage collection
	runtime.ReadMemStats(&finalStats)

	memoryIncrease := finalStats.Alloc - initialStats.Alloc
	t.Logf("Memory increase after %d requests: %d bytes (%.2f MB)",
		requests, memoryIncrease, float64(memoryIncrease)/1024/1024)

	// Assert reasonable memory usage (adjust based on your requirements)
	maxMemoryIncrease := uint64(50 * 1024 * 1024) // 50MB
	assert.Less(t, memoryIncrease, maxMemoryIncrease,
		"Memory increase should be less than 50MB for 1000 requests")
}

func testDatabaseConnectionPooling(t *testing.T, app *fiber.App, testDB *testutils.TestDatabase) {
	const (
		concurrency = 20
		requests    = 10
	)

	server := httptest.NewServer(app)
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}

	var wg sync.WaitGroup
	var connectionErrors int64

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			for j := 0; j < requests; j++ {
				body := fmt.Sprintf(`{
					"amount": 0.01,
					"resource": "pool-test-%d-%d",
					"description": "connection pool test"
				}`, workerID, j)

				req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/generate-payment", strings.NewReader(body))
				if err != nil {
					atomic.AddInt64(&connectionErrors, 1)
					continue
				}

				req.Header.Set("Content-Type", "application/json")

				resp, err := client.Do(req)
				if err != nil {
					if strings.Contains(err.Error(), "connection") {
						atomic.AddInt64(&connectionErrors, 1)
					}
					continue
				}

				resp.Body.Close()
			}
		}(i)
	}

	wg.Wait()

	t.Logf("Database connection errors: %d", connectionErrors)

	// Check database pool statistics
	stats := testDB.Pool.Stat()
	t.Logf("Database pool stats:")
	t.Logf("  Total connections: %d", stats.TotalConns())
	t.Logf("  Idle connections: %d", stats.IdleConns())
	t.Logf("  Acquired connections: %d", stats.AcquiredConns())

	// Assert connection pool is working correctly
	assert.Equal(t, int64(0), connectionErrors, "Should not have connection errors")
	assert.Greater(t, stats.TotalConns(), int32(0), "Should have database connections")
}

func testThroughputMeasurement(t *testing.T, app *fiber.App) {
	durations := []time.Duration{
		5 * time.Second,
		10 * time.Second,
	}

	for _, duration := range durations {
		t.Run(fmt.Sprintf("throughput_%v", duration), func(t *testing.T) {
			measureThroughput(t, app, duration)
		})
	}
}

func measureThroughput(t *testing.T, app *fiber.App, duration time.Duration) {
	server := httptest.NewServer(app)
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}

	var (
		requestCount int64
		errorCount   int64
	)

	start := time.Now()
	stop := time.After(duration)

	const workers = 10
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()

			requestID := 0
			for {
				select {
				case <-stop:
					return
				default:
					body := fmt.Sprintf(`{
						"amount": 0.01,
						"resource": "throughput-test-%d-%d",
						"description": "throughput test"
					}`, workerID, requestID)

					req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/generate-payment", strings.NewReader(body))
					if err != nil {
						atomic.AddInt64(&errorCount, 1)
						continue
					}

					req.Header.Set("Content-Type", "application/json")

					resp, err := client.Do(req)
					if err != nil {
						atomic.AddInt64(&errorCount, 1)
						continue
					}

					atomic.AddInt64(&requestCount, 1)
					resp.Body.Close()
					requestID++
				}
			}
		}(i)
	}

	wg.Wait()

	actualDuration := time.Since(start)
	rps := float64(requestCount) / actualDuration.Seconds()

	t.Logf("Throughput test (%v):", duration)
	t.Logf("  Total requests: %d", requestCount)
	t.Logf("  Total errors: %d", errorCount)
	t.Logf("  Actual duration: %v", actualDuration)
	t.Logf("  Requests per second: %.2f", rps)

	// Assert minimum throughput requirements
	assert.Greater(t, rps, 5.0, "Should achieve at least 5 RPS")
	assert.Greater(t, requestCount, int64(duration.Seconds()*5), "Should complete minimum requests")
}

func testResourceCleanup(t *testing.T, app *fiber.App) {
	// Test that resources are properly cleaned up after requests
	var initialStats runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&initialStats)

	server := httptest.NewServer(app)
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}

	// Create and complete many requests
	for i := 0; i < 500; i++ {
		body := fmt.Sprintf(`{
			"amount": 0.01,
			"resource": "cleanup-test-%d",
			"description": "resource cleanup test"
		}`, i)

		req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/generate-payment", strings.NewReader(body))
		if err != nil {
			continue
		}

		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			continue
		}

		// Read and close body to ensure proper cleanup
		var buf bytes.Buffer
		buf.ReadFrom(resp.Body)
		resp.Body.Close()
	}

	// Force garbage collection and check memory
	runtime.GC()
	time.Sleep(100 * time.Millisecond) // Give GC time to work
	runtime.GC()

	var finalStats runtime.MemStats
	runtime.ReadMemStats(&finalStats)

	// Check for goroutine leaks
	initialGoroutines := runtime.NumGoroutine()
	time.Sleep(1 * time.Second) // Allow goroutines to finish
	finalGoroutines := runtime.NumGoroutine()

	t.Logf("Goroutines: initial=%d, final=%d", initialGoroutines, finalGoroutines)
	t.Logf("Memory: initial=%d, final=%d", initialStats.Alloc, finalStats.Alloc)

	// Assert resource cleanup
	goroutineLeak := finalGoroutines - initialGoroutines
	assert.Less(t, goroutineLeak, 10, "Should not leak more than 10 goroutines")
}

func BenchmarkPaymentGeneration(b *testing.B) {
	testDB := testutils.SetupTestDatabase(&testing.T{})
	defer testDB.Cleanup(&testing.T{})
	testDB.CreateTestSchema(&testing.T{})

	app := fiber.New()
	app.Post("/v1/generate-payment", merchantHandlers.GeneratePayment(testDB.Pool))

	body := `{"amount": 0.01, "resource": "benchmark-test", "description": "benchmark test"}`

	b.ResetTimer()
	b.ReportAllocs()

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			req := httptest.NewRequest(http.MethodPost, "/v1/generate-payment", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			resp, err := app.Test(req)
			if err != nil {
				b.Fatal(err)
			}
			resp.Body.Close()
		}
	})
}