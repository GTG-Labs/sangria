// Package disco ranks merchant products against a free-text query for the
// /v1/buy discovery flow. Pure functions, no IO — the buyHandler fetches a
// catalog from the merchant, flattens its products into []ScoredProduct
// (each carrying its source Store), and asks Top3 for the best matches.
//
// V1 ranking is normalized word-overlap: tokenize query + product
// (name + category) into a deduplicated set of lowercase alphanumeric
// tokens, count common tokens, divide by query token count. Simple, easy
// to reason about, easy to swap for tsvector / BM25 / embeddings later
// without changing Score's signature.
package disco

import (
	"sort"
	"strings"
	"unicode"

	"sangria/backend/sangriamerchant"
)

// ScoredProduct pairs a product with its source store and computed score.
// Callers build a slice of these (Score left zero) and pass it to Top3,
// which populates Score in place and returns the top-N.
type ScoredProduct struct {
	Product sangriamerchant.Product
	Store   sangriamerchant.Store
	Score   float64
}

// topN is the maximum number of products returned by Top3. Hardcoded for V1;
// promote to a function parameter if a future caller needs a different cap.
const topN = 3

// Score returns a normalized word-overlap match score for a single product
// against the query. Range is [0.0, 1.0]; returns 0.0 for empty queries or
// zero token overlap.
//
// Tokenization: lowercase the input, split on every non-alphanumeric rune
// (whitespace, punctuation, slashes, hyphens all become separators).
// Category being slash- and hyphen-delimited
// ("grocery-and-gourmet-food/beverages/coffee/single-serve-capsules-and-pods")
// naturally falls apart into matchable tokens this way — no special-cased
// splitter needed.
//
// Tokens are deduplicated per-input so repeat-keyword stuffing can't
// inflate scores.
func Score(query string, product sangriamerchant.Product) float64 {
	queryTokens := tokenize(query)
	if len(queryTokens) == 0 {
		return 0.0
	}
	productTokens := tokenize(product.Name + " " + product.Category)
	overlap := 0
	for tok := range queryTokens {
		if _, ok := productTokens[tok]; ok {
			overlap++
		}
	}
	return float64(overlap) / float64(len(queryTokens))
}

// Top3 scores every candidate, drops anything below threshold > 0.0
// (any non-zero overlap qualifies), sorts descending by score, and returns
// up to the top 3 (or fewer if not enough candidates clear the threshold).
//
// Mutates the input slice's Score field in place; do not reuse a candidate
// slice across calls without rebuilding it.
//
// Sort is stable — when two products tie on score, input order wins. The
// merchant's catalog order is their choice and probably reflects featured
// ordering, so honoring it as a tie-breaker is reasonable.
func Top3(query string, candidates []ScoredProduct) []ScoredProduct {
	for i := range candidates {
		candidates[i].Score = Score(query, candidates[i].Product)
	}

	// Filter in place — preserves input order before sort, which matters
	// for the stable-sort tie-break.
	filtered := candidates[:0]
	for _, c := range candidates {
		if c.Score > 0.0 {
			filtered = append(filtered, c)
		}
	}

	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i].Score > filtered[j].Score
	})

	if len(filtered) > topN {
		return filtered[:topN]
	}
	return filtered
}

// tokenize lowercases s and splits it into a deduplicated set of
// alphanumeric tokens. Empty inputs return an empty set.
func tokenize(s string) map[string]struct{} {
	if s == "" {
		return map[string]struct{}{}
	}
	out := map[string]struct{}{}
	for _, word := range strings.FieldsFunc(strings.ToLower(s), isTokenSeparator) {
		if word == "" {
			continue
		}
		out[word] = struct{}{}
	}
	return out
}

// isTokenSeparator returns true for every rune that should split tokens.
// Anything that isn't a letter or digit is a separator — covers whitespace,
// punctuation, slashes, hyphens, underscores, and all the other delimiters
// merchants might use in product names + slash-delimited category paths.
func isTokenSeparator(r rune) bool {
	return !unicode.IsLetter(r) && !unicode.IsDigit(r)
}
