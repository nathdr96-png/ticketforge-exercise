package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ticketforge/backend-go/internal/apperr"
	"ticketforge/backend-go/internal/auth"
	"ticketforge/backend-go/internal/store"
)

type Hold struct {
	ID        string   `json:"id"`
	EventID   string   `json:"event_id"`
	BuyerID   string   `json:"buyer_id"`
	SeatIDs   []string `json:"seat_ids"`
	Status    string   `json:"status"`
	ExpiresAt string   `json:"expires_at"`
	CreatedAt string   `json:"created_at"`
}

// holdRow keeps the raw timestamps so TTL comparisons stay in time.Time.
type holdRow struct {
	ID        string
	EventID   string
	BuyerID   string
	SeatIDs   []string
	Status    string
	ExpiresAt time.Time
	CreatedAt time.Time
}

func (h *holdRow) api() *Hold {
	seats := h.SeatIDs
	if seats == nil {
		seats = []string{}
	}
	return &Hold{
		ID:        h.ID,
		EventID:   h.EventID,
		BuyerID:   h.BuyerID,
		SeatIDs:   seats,
		Status:    h.Status,
		ExpiresAt: iso(h.ExpiresAt),
		CreatedAt: iso(h.CreatedAt),
	}
}

func (s *Service) fetchHold(ctx context.Context, q store.Querier, holdID string) (*holdRow, error) {
	var h holdRow
	err := q.QueryRow(ctx, `
		SELECT h.id, h.event_id, h.buyer_id, h.status::text, h.expires_at, h.created_at,
		       COALESCE(
		         array_agg(hs.seat_id ORDER BY hs.seat_id)
		           FILTER (WHERE hs.seat_id IS NOT NULL),
		         '{}'
		       ) AS seat_ids
		FROM holds h
		LEFT JOIN hold_seats hs ON hs.hold_id = h.id
		WHERE h.id = $1
		GROUP BY h.id`, holdID).
		Scan(&h.ID, &h.EventID, &h.BuyerID, &h.Status, &h.ExpiresAt, &h.CreatedAt, &h.SeatIDs)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.New(apperr.HoldNotFound, "Hold not found")
		}
		return nil, err
	}
	return &h, nil
}

// CreateHold places an exclusive hold on the requested seats.
//
// Locking strategy (Postgres only):
//  1. open a transaction
//  2. SELECT ... FOR UPDATE the seat rows ORDER BY id — a stable global order,
//     so two concurrent requests for overlapping seats can never deadlock and
//     the loser blocks until the winner commits
//  3. re-check each seat's status under the lock before marking it held
func (s *Service) CreateHold(
	ctx context.Context, user *auth.User, eventID string, seatIDs []string,
) (*Hold, error) {
	if len(seatIDs) == 0 {
		return nil, apperr.New(apperr.ValidationError, "seat_ids required")
	}
	unique := sortedUnique(seatIDs)

	var out *Hold
	err := store.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := s.getEvent(ctx, tx, eventID); err != nil {
			return err
		}

		rows, err := tx.Query(ctx, `
			SELECT id, event_id, status::text
			FROM seats
			WHERE id = ANY($1::text[])
			ORDER BY id
			FOR UPDATE`, unique)
		if err != nil {
			return err
		}
		type seatLock struct {
			id      string
			eventID string
			status  string
		}
		locked := make([]seatLock, 0, len(unique))
		for rows.Next() {
			var sl seatLock
			if err := rows.Scan(&sl.id, &sl.eventID, &sl.status); err != nil {
				rows.Close()
				return err
			}
			locked = append(locked, sl)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		if len(locked) != len(unique) {
			return apperr.New(apperr.SeatNotFound, "One or more seats not found")
		}

		for _, sl := range locked {
			if sl.eventID != eventID {
				return apperr.WithDetails(apperr.ValidationError,
					"Seat does not belong to event", map[string]any{"seat_id": sl.id})
			}
			switch sl.status {
			case "held":
				return apperr.WithDetails(apperr.SeatAlreadyHeld,
					"Seat is currently held", map[string]any{"seat_id": sl.id})
			case "sold":
				return apperr.WithDetails(apperr.SeatNotAvailable,
					"Seat is sold", map[string]any{"seat_id": sl.id})
			}
		}

		holdID := newID("hold_")
		now := time.Now().UTC().Truncate(time.Millisecond)
		expires := now.Add(time.Duration(s.cfg.HoldTTLSeconds) * time.Second)

		if _, err := tx.Exec(ctx, `
			INSERT INTO holds (id, event_id, buyer_id, status, expires_at, created_at)
			VALUES ($1, $2, $3, 'active', $4, $5)`,
			holdID, eventID, user.ID, expires, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO hold_seats (hold_id, seat_id)
			SELECT $1, unnest($2::text[])`, holdID, unique); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE seats
			SET status = 'held', hold_id = $1, version = version + 1
			WHERE id = ANY($2::text[])`, holdID, unique); err != nil {
			return err
		}

		if err := s.emit(ctx, tx, "hold.created", map[string]any{
			"event_type":  "hold.created",
			"hold_id":     holdID,
			"event_id":    eventID,
			"buyer_id":    user.ID,
			"seat_ids":    unique,
			"expires_at":  iso(expires),
			"occurred_at": iso(now),
		}); err != nil {
			return err
		}

		out = &Hold{
			ID:        holdID,
			EventID:   eventID,
			BuyerID:   user.ID,
			SeatIDs:   unique,
			Status:    "active",
			ExpiresAt: iso(expires),
			CreatedAt: iso(now),
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetHold returns a hold the caller owns (admins may read any). A hold whose
// TTL has elapsed is expired on read and reported as HOLD_EXPIRED.
func (s *Service) GetHold(ctx context.Context, user *auth.User, holdID string) (*Hold, error) {
	h, err := s.fetchHold(ctx, s.pool, holdID)
	if err != nil {
		return nil, err
	}
	if !isAdmin(user) && h.BuyerID != user.ID {
		return nil, apperr.New(apperr.InsufficientPermission, "Not your hold")
	}
	if h.Status == "active" && !h.ExpiresAt.After(time.Now().UTC()) {
		if err := s.ExpireHold(ctx, holdID); err != nil {
			return nil, err
		}
		return nil, apperr.New(apperr.HoldExpired, "Hold has expired")
	}
	return h.api(), nil
}

// ReleaseHold frees the seats of an active hold.
func (s *Service) ReleaseHold(ctx context.Context, user *auth.User, holdID string) error {
	return store.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		h, err := s.fetchHold(ctx, tx, holdID)
		if err != nil {
			return err
		}
		if !isAdmin(user) && h.BuyerID != user.ID {
			return apperr.New(apperr.InsufficientPermission, "Not your hold")
		}
		switch h.Status {
		case "expired", "released":
			return apperr.New(apperr.HoldExpired, "Hold has expired")
		case "converted":
			return apperr.New(apperr.HoldAlreadyConverted, "Hold already converted")
		}

		// Lock the seats in id order before mutating them.
		if _, err := tx.Exec(ctx,
			`SELECT id FROM seats WHERE hold_id = $1 ORDER BY id FOR UPDATE`, holdID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE holds SET status = 'released' WHERE id = $1`, holdID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
			WHERE hold_id = $1`, holdID); err != nil {
			return err
		}
		// No outbox event here: contract/events.yaml declares only
		// hold.created, hold.expired and order.paid.
		_, err = tx.Exec(ctx, `DELETE FROM hold_seats WHERE hold_id = $1`, holdID)
		return err
	})
}

// ExpireHold marks one active, past-TTL hold expired and releases its seats.
// It is idempotent and safe to call concurrently: the hold row is locked first
// and a hold that is no longer active is a no-op.
func (s *Service) ExpireHold(ctx context.Context, holdID string) error {
	return store.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var eventID, buyerID, status string
		err := tx.QueryRow(ctx,
			`SELECT event_id, buyer_id, status::text FROM holds WHERE id = $1 FOR UPDATE`, holdID).
			Scan(&eventID, &buyerID, &status)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return err
		}
		if status != "active" {
			return nil
		}

		rows, err := tx.Query(ctx,
			`SELECT seat_id FROM hold_seats WHERE hold_id = $1 ORDER BY seat_id`, holdID)
		if err != nil {
			return err
		}
		seatIDs := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			seatIDs = append(seatIDs, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx,
			`SELECT id FROM seats WHERE hold_id = $1 ORDER BY id FOR UPDATE`, holdID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE holds SET status = 'expired' WHERE id = $1`, holdID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE seats SET status = 'available', hold_id = NULL, version = version + 1
			WHERE hold_id = $1 AND status = 'held'`, holdID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM hold_seats WHERE hold_id = $1`, holdID); err != nil {
			return err
		}
		return s.emit(ctx, tx, "hold.expired", map[string]any{
			"event_type":  "hold.expired",
			"hold_id":     holdID,
			"event_id":    eventID,
			"buyer_id":    buyerID,
			"seat_ids":    seatIDs,
			"occurred_at": iso(time.Now().UTC()),
		})
	})
}

// ExpireDueHolds is the background worker tick: it expires up to limit holds
// whose TTL has elapsed.
func (s *Service) ExpireDueHolds(ctx context.Context, limit int) (int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id FROM holds
		WHERE status = 'active' AND expires_at <= NOW()
		ORDER BY expires_at
		LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := s.ExpireHold(ctx, id); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}

// emit appends a domain event to the transactional outbox.
func (s *Service) emit(ctx context.Context, q store.Querier, eventType string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx,
		`INSERT INTO outbox_events (event_type, payload) VALUES ($1, $2::jsonb)`,
		eventType, string(raw))
	return err
}
