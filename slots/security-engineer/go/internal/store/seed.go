package store

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type seedMeta struct {
	PasswordForAllUsers string `json:"password_for_all_users"`
	HoldTTLSeconds      int    `json:"hold_ttl_seconds"`
}

type seedUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role"`
	Name  string `json:"name"`
}

type seedEvent struct {
	ID             string `json:"id"`
	OrganizerID    string `json:"organizer_id"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	Venue          string `json:"venue"`
	StartsAt       string `json:"starts_at"`
	Currency       string `json:"currency"`
	BasePriceCents int    `json:"base_price_cents"`
	Status         string `json:"status"`
}

type seedDiscount struct {
	Code       string  `json:"code"`
	PercentOff int     `json:"percent_off"`
	Active     bool    `json:"active"`
	Stackable  bool    `json:"stackable"`
	EventID    *string `json:"event_id"`
}

type seedFile struct {
	Meta      seedMeta       `json:"meta"`
	Users     []seedUser     `json:"users"`
	Events    []seedEvent    `json:"events"`
	Discounts []seedDiscount `json:"discounts"`
}

type seedSeat struct {
	ID         string `json:"id"`
	EventID    string `json:"event_id"`
	Section    string `json:"section"`
	Row        string `json:"row"`
	Number     int    `json:"number"`
	Status     string `json:"status"`
	PriceCents int    `json:"price_cents"`
}

type seatsFile struct {
	Total int        `json:"total"`
	Seats []seedSeat `json:"seats"`
}

// Seed loads contract/seed/*.json deterministically. It migrates first so the
// load always starts from a clean canonical schema.
func Seed(ctx context.Context, pool *pgxpool.Pool, contractDir string, bcryptCost int) error {
	if err := Migrate(ctx, pool, contractDir); err != nil {
		return err
	}

	seedDir := filepath.Join(contractDir, "seed")

	var sf seedFile
	if err := readJSON(filepath.Join(seedDir, "seed.json"), &sf); err != nil {
		return err
	}
	var seats seatsFile
	if err := readJSON(filepath.Join(seedDir, "seats.json"), &seats); err != nil {
		return err
	}

	// Every seeded user shares one password (contract/seed/README.md); hash it
	// once at cost 10 as the fixtures require.
	hash, err := bcrypt.GenerateFromPassword([]byte(sf.Meta.PasswordForAllUsers), bcryptCost)
	if err != nil {
		return fmt.Errorf("bcrypt: %w", err)
	}
	passwordHash := string(hash)

	return WithTx(ctx, pool, func(tx pgx.Tx) error {
		for _, u := range sf.Users {
			if _, err := tx.Exec(ctx,
				`INSERT INTO users (id, email, password_hash, role, name)
				 VALUES ($1, $2, $3, $4::text::user_role, $5)`,
				u.ID, u.Email, passwordHash, u.Role, u.Name); err != nil {
				return fmt.Errorf("insert user %s: %w", u.ID, err)
			}
		}

		for _, e := range sf.Events {
			if _, err := tx.Exec(ctx,
				`INSERT INTO events
				   (id, organizer_id, title, description, venue, starts_at,
				    currency, base_price_cents, status)
				 VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9::text::event_status)`,
				e.ID, e.OrganizerID, e.Title, e.Description, e.Venue, e.StartsAt,
				e.Currency, e.BasePriceCents, e.Status); err != nil {
				return fmt.Errorf("insert event %s: %w", e.ID, err)
			}
		}

		rows := make([][]any, 0, len(seats.Seats))
		for _, s := range seats.Seats {
			rows = append(rows, []any{s.ID, s.EventID, s.Section, s.Row, s.Number, s.Status, s.PriceCents})
		}
		// Staging table keeps CopyFrom usable despite the enum columns.
		if _, err := tx.Exec(ctx, `
			CREATE TEMP TABLE seats_staging (
			  id TEXT, event_id TEXT, section TEXT, row_label TEXT,
			  number INTEGER, status TEXT, price_cents INTEGER
			) ON COMMIT DROP`); err != nil {
			return fmt.Errorf("create seats_staging: %w", err)
		}
		if _, err := tx.CopyFrom(ctx,
			pgx.Identifier{"seats_staging"},
			[]string{"id", "event_id", "section", "row_label", "number", "status", "price_cents"},
			pgx.CopyFromRows(rows)); err != nil {
			return fmt.Errorf("copy seats: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO seats (id, event_id, section, row_label, number, status, price_cents)
			SELECT id, event_id, section::seat_section, row_label, number,
			       status::seat_status, price_cents
			FROM seats_staging
			ORDER BY id`); err != nil {
			return fmt.Errorf("insert seats: %w", err)
		}

		for _, d := range sf.Discounts {
			if _, err := tx.Exec(ctx,
				`INSERT INTO discounts (code, percent_off, active, stackable, event_id)
				 VALUES ($1,$2,$3,$4,$5)`,
				d.Code, d.PercentOff, d.Active, d.Stackable, d.EventID); err != nil {
				return fmt.Errorf("insert discount %s: %w", d.Code, err)
			}
		}

		fmt.Printf("Seeded %d users, %d events, %d seats, %d discounts\n",
			len(sf.Users), len(sf.Events), len(seats.Seats), len(sf.Discounts))
		return nil
	})
}

func readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}
