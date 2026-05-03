package config

import (
	"fmt"
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

// LoadLoggingConfig installs slog's default handler. Empty LOG_LEVEL/LOG_FORMAT
// take safe defaults (info/text); typos return an error so misconfigs like
// LOG_LEVEL=warning don't fall through silently. APP_ENV (NODE_ENV fallback) is unvalidated.
func LoadLoggingConfig() error {
	rawLevel := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL")))
	switch rawLevel {
	case "":
		Logging.Level = slog.LevelInfo
	case "debug":
		Logging.Level = slog.LevelDebug
	case "info":
		Logging.Level = slog.LevelInfo
	case "warn":
		Logging.Level = slog.LevelWarn
	case "error":
		Logging.Level = slog.LevelError
	default:
		return fmt.Errorf("invalid LOG_LEVEL %q: must be one of debug | info | warn | error", rawLevel)
	}

	rawFormat := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_FORMAT")))
	switch rawFormat {
	case "", "text":
		Logging.Format = "text"
	case "json":
		Logging.Format = "json"
	default:
		return fmt.Errorf("invalid LOG_FORMAT %q: must be one of text | json", rawFormat)
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
