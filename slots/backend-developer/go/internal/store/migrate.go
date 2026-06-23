package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Migrate applies contract/schema.sql verbatim after resetting the public
// schema, so migrate+seed is deterministic and repeatable.
func Migrate(ctx context.Context, pool *pgxpool.Pool, contractDir string) error {
	path := filepath.Join(contractDir, "schema.sql")
	sql, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if _, err := pool.Exec(ctx, `
		DROP SCHEMA public CASCADE;
		CREATE SCHEMA public;
		GRANT ALL ON SCHEMA public TO public;
	`); err != nil {
		return fmt.Errorf("reset public schema: %w", err)
	}
	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		return fmt.Errorf("apply schema.sql: %w", err)
	}
	fmt.Printf("Migrated schema from %s\n", path)
	return nil
}
