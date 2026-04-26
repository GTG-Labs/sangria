package config

import (
	"log/slog"
	"os"
	"strings"
)

// Logging holds the structured-logger configuration loaded from environment.
var Logging LoggingConfig

// LoggingConfig defines the slog handler shape.
//
// AppEnv is the canonical environment selector used by `IsProduction()` and
// any other env-aware branches. NODE_ENV is read as a fallback so a misconfigured
// deploy that still carries the legacy JS-ish name keeps working; operators should
// migrate to APP_ENV.
type LoggingConfig struct {
	Level  slog.Level
	Format string // "json" or "text"
	AppEnv string // "development" | "staging" | "production" (lowercased)
}

// LoadLoggingConfig reads LOG_LEVEL, LOG_FORMAT, APP_ENV (falling back to
// NODE_ENV). Installs the result as slog's default logger. Safe defaults for
// missing values: info level, text format, empty AppEnv (treated as prod by
// IsProduction so "unset" doesn't silently relax security).
func LoadLoggingConfig() error {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL"))) {
	case "debug":
		Logging.Level = slog.LevelDebug
	case "warn":
		Logging.Level = slog.LevelWarn
	case "error":
		Logging.Level = slog.LevelError
	default:
		Logging.Level = slog.LevelInfo
	}

	if strings.EqualFold(strings.TrimSpace(os.Getenv("LOG_FORMAT")), "json") {
		Logging.Format = "json"
	} else {
		Logging.Format = "text"
	}

	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if appEnv == "" {
		appEnv = strings.ToLower(strings.TrimSpace(os.Getenv("NODE_ENV")))
	}
	Logging.AppEnv = appEnv

	opts := &slog.HandlerOptions{Level: Logging.Level}
	var handler slog.Handler
	if Logging.Format == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	slog.SetDefault(slog.New(handler))

	return nil
}

// IsDevelopment returns true when APP_ENV (or NODE_ENV fallback) is
// "development". Unset defaults to false — i.e., assume production security
// posture when not explicitly opted into dev.
func (c LoggingConfig) IsDevelopment() bool {
	return c.AppEnv == "development"
}

// IsProduction returns true when APP_ENV is anything other than "development".
// Matches the prior convention in auth/csrf.go where missing APP_ENV was
// treated as prod (strict cookies, HTTPS required).
func (c LoggingConfig) IsProduction() bool {
	return !c.IsDevelopment()
}
