// Package config loads TicketForge runtime configuration from the environment.
package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Port             int
	DatabaseURL      string
	JWTSecret        string
	HoldTTLSeconds   int
	FeePercent       int
	FeeFixedCents    int
	LogLevel         string
	ContractDir      string
	BcryptCost       int
	MaxDBConns       int
	HoldExpiryTickMS int
}

func Load() Config {
	return Config{
		Port:             envInt("PORT", 3000),
		DatabaseURL:      envStr("DATABASE_URL", "postgres://ticketforge:ticketforge@localhost:5432/ticketforge"),
		JWTSecret:        envStr("JWT_SECRET", "ticketforge-dev-secret-change-me"),
		HoldTTLSeconds:   envInt("HOLD_TTL_SECONDS", 600),
		FeePercent:       envInt("FEE_PERCENT", 5),
		FeeFixedCents:    envInt("FEE_FIXED_CENTS", 30),
		LogLevel:         envStr("LOG_LEVEL", "info"),
		ContractDir:      resolveContractDir(envStr("CONTRACT_DIR", "")),
		BcryptCost:       envInt("BCRYPT_COST", 10),
		MaxDBConns:       envInt("DB_MAX_CONNS", 20),
		HoldExpiryTickMS: envInt("HOLD_EXPIRY_TICK_MS", 1000),
	}
}

func envStr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// resolveContractDir finds the repo's contract/ directory. The contract is the
// source of truth for the schema and the seed fixtures, so migrate/seed read it
// verbatim rather than keeping a copy.
func resolveContractDir(explicit string) string {
	if explicit != "" {
		return explicit
	}
	candidates := []string{}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, cwd)
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Dir(exe))
	}
	for _, start := range candidates {
		dir := start
		for i := 0; i < 8; i++ {
			probe := filepath.Join(dir, "contract", "schema.sql")
			if _, err := os.Stat(probe); err == nil {
				return filepath.Join(dir, "contract")
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "contract"
}
