package utils

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"time"
)

// ParsePaginationParams extracts limit and cursor from query parameters
// Returns (limit, cursorTime, error)
// - limit defaults to 20, capped at 100
// - cursorTime is nil for first page
func ParsePaginationParams(limitStr, cursorStr string) (int, *time.Time, error) {
	limit := 20 // Default page size
	if limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed < 1 {
			return 0, nil, fmt.Errorf("invalid limit parameter")
		}
		if parsed > 100 {
			limit = 100 // Cap at max
		} else {
			limit = parsed
		}
	}

	var cursorTime *time.Time
	if cursorStr != "" {
		decoded, err := base64.StdEncoding.DecodeString(cursorStr)
		if err != nil {
			return 0, nil, fmt.Errorf("invalid cursor encoding")
		}
		t, err := time.Parse(time.RFC3339Nano, string(decoded))
		if err != nil {
			return 0, nil, fmt.Errorf("invalid cursor timestamp format")
		}
		cursorTime = &t
	}

	return limit, cursorTime, nil
}

// EncodeCursor converts a timestamp to a base64-encoded cursor
func EncodeCursor(t time.Time) string {
	return base64.StdEncoding.EncodeToString([]byte(t.Format(time.RFC3339Nano)))
}
