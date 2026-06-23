package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ticketforge/backend-go/internal/apperr"
	"ticketforge/backend-go/internal/auth"
	"ticketforge/backend-go/internal/money"
	"ticketforge/backend-go/internal/store"
)

// minIdempotencyKeyLen: a key shorter than this is treated as absent
// (IDEMPOTENCY_KEY_REQUIRED).
const minIdempotencyKeyLen = 8

type Order struct {
	ID            string   `json:"id"`
	HoldID        string   `json:"hold_id"`
	BuyerID       string   `json:"buyer_id"`
	EventID       string   `json:"event_id"`
	SeatIDs       []string `json:"seat_ids"`
	SubtotalCents int      `json:"subtotal_cents"`
	FeeCents      int      `json:"fee_cents"`
	DiscountCents int      `json:"discount_cents"`
	TotalCents    int      `json:"total_cents"`
	Currency      string   `json:"currency"`
	DiscountCode  *string  `json:"discount_code"`
	Status        string   `json:"status"`
	CreatedAt     string   `json:"created_at"`
}

// OrderRequest is the POST /orders body.
type OrderRequest struct {
	HoldID       string  `json:"hold_id"`
	DiscountCode *string `json:"discount_code"`
}

// Hash is the canonical fingerprint of the request body used to detect an
// idempotency key being replayed with a mutated body. Marshalling a fixed
// struct makes it independent of the incoming key order and whitespace.
func (r OrderRequest) Hash() string {
	raw, _ := json.Marshal(r)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// CreateOrder converts a hold into a paid order. Returns replay=true when an
// earlier order is being returned for a repeated Idempotency-Key.
func (s *Service) CreateOrder(
	ctx context.Context, user *auth.User, idempotencyKey string, req OrderRequest,
) (order *Order, replay bool, err error) {
	if len(idempotencyKey) < minIdempotencyKeyLen {
		return nil, false, apperr.New(apperr.IdempotencyKeyRequired,
			"Idempotency-Key header required")
	}

	// A concurrent request with the same key can lose the unique-index race on
	// idempotency_records; retry once so it observes the winner's order instead
	// of surfacing a database error.
	for attempt := 0; attempt < 2; attempt++ {
		order, replay, err = s.createOrderOnce(ctx, user, idempotencyKey, req)
		if err == nil || !isUniqueViolation(err) {
			return order, replay, err
		}
	}
	return order, replay, err
}

func (s *Service) createOrderOnce(
	ctx context.Context, user *auth.User, idempotencyKey string, req OrderRequest,
) (*Order, bool, error) {
	requestHash := req.Hash()

	var (
		out      *Order
		isReplay bool
	)

	err := store.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		// 1. Idempotency first: a replay must not be affected by the current
		//    state of the hold it originally consumed.
		var storedHash, storedOrderID string
		err := tx.QueryRow(ctx, `
			SELECT request_hash, order_id FROM idempotency_records
			WHERE buyer_id = $1 AND idempotency_key = $2
			FOR UPDATE`, user.ID, idempotencyKey).Scan(&storedHash, &storedOrderID)
		switch {
		case err == nil:
			if storedHash != requestHash {
				return apperr.New(apperr.IdempotencyKeyConflict,
					"Idempotency key reused with a different body")
			}
			existing, err := s.fetchOrder(ctx, tx, storedOrderID)
			if err != nil {
				return err
			}
			out, isReplay = existing, true
			return nil
		case errors.Is(err, pgx.ErrNoRows):
			// fall through to a fresh order
		default:
			return err
		}

		// 2. Validate the hold.
		hold, err := s.fetchHold(ctx, tx, req.HoldID)
		if err != nil {
			return err
		}
		if hold.BuyerID != user.ID && !isAdmin(user) {
			return apperr.New(apperr.InsufficientPermission, "Not your hold")
		}
		// TODO: checkout does not yet refuse a hold that is no longer live.

		// 3. Lock the hold, then its seats in id order.
		if _, err := tx.Exec(ctx, `SELECT id FROM holds WHERE id = $1 FOR UPDATE`, hold.ID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT id, price_cents, status::text
			FROM seats
			WHERE id = ANY($1::text[])
			ORDER BY id
			FOR UPDATE`, hold.SeatIDs)
		if err != nil {
			return err
		}
		type seatRow struct {
			id     string
			price  int
			status string
		}
		seats := make([]seatRow, 0, len(hold.SeatIDs))
		for rows.Next() {
			var sr seatRow
			if err := rows.Scan(&sr.id, &sr.price, &sr.status); err != nil {
				rows.Close()
				return err
			}
			seats = append(seats, sr)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(seats) == 0 {
			return apperr.New(apperr.SeatNotFound, "Hold has no seats")
		}
		for _, sr := range seats {
			if sr.status == "sold" {
				return apperr.WithDetails(apperr.SeatNotAvailable, "Seat is sold",
					map[string]any{"seat_id": sr.id})
			}
		}

		// 4. Money: integer cents throughout.
		subtotal := 0
		seatIDs := make([]string, 0, len(seats))
		for _, sr := range seats {
			subtotal += sr.price
			seatIDs = append(seatIDs, sr.id)
		}

		// TODO(FEAT-18): discount codes are not implemented yet.
		discountCents := 0
		var discountCode *string

		afterDiscount := subtotal - discountCents
		feeCents := money.FeeCents(afterDiscount, s.cfg.FeePercent, s.cfg.FeeFixedCents)
		totalCents := money.TotalCents(subtotal, discountCents, feeCents)

		var currency string
		if err := tx.QueryRow(ctx, `SELECT currency FROM events WHERE id = $1`, hold.EventID).
			Scan(&currency); err != nil {
			return err
		}
		currency = strings.TrimSpace(currency)

		// 5. Persist.
		orderID := newID("ord_")
		now := time.Now().UTC().Truncate(time.Millisecond)

		if _, err := tx.Exec(ctx, `
			INSERT INTO orders
			  (id, hold_id, buyer_id, event_id, subtotal_cents, fee_cents, discount_cents,
			   total_cents, currency, discount_code, status, idempotency_key, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'paid',$11,$12)`,
			orderID, hold.ID, user.ID, hold.EventID, subtotal, feeCents, discountCents,
			totalCents, currency, discountCode, idempotencyKey, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_seats (order_id, seat_id)
			SELECT $1, unnest($2::text[])`, orderID, seatIDs); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE seats SET status = 'sold', hold_id = NULL, version = version + 1
			WHERE id = ANY($1::text[])`, seatIDs); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE holds SET status = 'converted' WHERE id = $1`, hold.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO idempotency_records (buyer_id, idempotency_key, request_hash, order_id)
			VALUES ($1,$2,$3,$4)`, user.ID, idempotencyKey, requestHash, orderID); err != nil {
			return err
		}
		if err := s.emit(ctx, tx, "order.paid", map[string]any{
			"event_type":  "order.paid",
			"order_id":    orderID,
			"hold_id":     hold.ID,
			"event_id":    hold.EventID,
			"buyer_id":    user.ID,
			"total_cents": totalCents,
			"currency":    currency,
			"occurred_at": iso(now),
		}); err != nil {
			return err
		}

		created, err := s.fetchOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		out, isReplay = created, false
		return nil
	})

	if err != nil {
		return nil, false, err
	}
	return out, isReplay, nil
}

func (s *Service) fetchOrder(ctx context.Context, q store.Querier, orderID string) (*Order, error) {
	var o Order
	var createdAt time.Time
	err := q.QueryRow(ctx, `
		SELECT o.id, o.hold_id, o.buyer_id, o.event_id,
		       o.subtotal_cents, o.fee_cents, o.discount_cents, o.total_cents,
		       o.currency, o.discount_code, o.status::text, o.created_at,
		       COALESCE(
		         array_agg(os.seat_id ORDER BY os.seat_id)
		           FILTER (WHERE os.seat_id IS NOT NULL),
		         '{}'
		       ) AS seat_ids
		FROM orders o
		LEFT JOIN order_seats os ON os.order_id = o.id
		WHERE o.id = $1
		GROUP BY o.id`, orderID).
		Scan(&o.ID, &o.HoldID, &o.BuyerID, &o.EventID,
			&o.SubtotalCents, &o.FeeCents, &o.DiscountCents, &o.TotalCents,
			&o.Currency, &o.DiscountCode, &o.Status, &createdAt, &o.SeatIDs)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.New(apperr.OrderNotFound, "Order not found")
		}
		return nil, err
	}
	o.Currency = strings.TrimSpace(o.Currency)
	o.CreatedAt = iso(createdAt)
	if o.SeatIDs == nil {
		o.SeatIDs = []string{}
	}
	return &o, nil
}

// GetOrder is readable by the buyer, an admin, or the organizer of the event.
// Everyone else gets INSUFFICIENT_PERMISSION — never a 404 that would leak
// whether the order exists.
func (s *Service) GetOrder(ctx context.Context, user *auth.User, orderID string) (*Order, error) {
	o, err := s.fetchOrder(ctx, s.pool, orderID)
	if err != nil {
		return nil, err
	}
	if isAdmin(user) || o.BuyerID == user.ID {
		return o, nil
	}
	if user.Role == auth.RoleOrganizer {
		var organizerID string
		err := s.pool.QueryRow(ctx, `SELECT organizer_id FROM events WHERE id = $1`, o.EventID).
			Scan(&organizerID)
		if err == nil && organizerID == user.ID {
			return o, nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	return nil, apperr.New(apperr.InsufficientPermission, "Not allowed to view this order")
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
