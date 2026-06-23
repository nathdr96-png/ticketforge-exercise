// Package service implements the TicketForge domain logic: events, seat maps,
// holds, orders and the revenue report.
//
// Concurrency: seat exclusivity relies on Postgres row locks alone. Every path
// that mutates seat state opens a transaction and takes
// SELECT ... FOR UPDATE on the seat rows ORDERED BY id, so concurrent
// requests serialise on the same rows in the same order (no deadlocks, no
// oversell). No Redis or other external lock service is required.
package service

import (
	"crypto/rand"
	"encoding/hex"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"ticketforge/backend-go/internal/auth"
	"ticketforge/backend-go/internal/config"
)

// isoLayout renders UTC ISO-8601 with millisecond precision and a Z suffix,
// matching the contract (e.g. 2026-06-15T19:00:00.000Z).
const isoLayout = "2006-01-02T15:04:05.000Z07:00"

func iso(t time.Time) string { return t.UTC().Format(isoLayout) }

type Service struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func New(pool *pgxpool.Pool, cfg config.Config) *Service {
	return &Service{pool: pool, cfg: cfg}
}

// Page is the standard paginated envelope.
type Page[T any] struct {
	Data     []T `json:"data"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
	Total    int `json:"total"`
}

func newID(prefix string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failure is unrecoverable; fall back to time entropy.
		now := time.Now().UnixNano()
		for i := range buf {
			buf[i] = byte(now >> (8 * i))
		}
	}
	return prefix + hex.EncodeToString(buf)
}

// sortedUnique de-duplicates and sorts seat ids. Sorting is what gives the
// FOR UPDATE lock acquisition a global order.
func sortedUnique(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

func isAdmin(u *auth.User) bool { return u != nil && u.Role == auth.RoleAdmin }
