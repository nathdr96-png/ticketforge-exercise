package service

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ticketforge/backend-go/internal/apperr"
	"ticketforge/backend-go/internal/store"
)

type Event struct {
	ID             string `json:"id"`
	OrganizerID    string `json:"organizer_id"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	Venue          string `json:"venue"`
	StartsAt       string `json:"starts_at"`
	Currency       string `json:"currency"`
	BasePriceCents int    `json:"base_price_cents"`
	Status         string `json:"status"`
	SeatCount      int    `json:"seat_count"`
}

type Seat struct {
	ID         string `json:"id"`
	EventID    string `json:"event_id"`
	Section    string `json:"section"`
	Row        string `json:"row"`
	Number     int    `json:"number"`
	Status     string `json:"status"`
	PriceCents int    `json:"price_cents"`
}

const eventSelect = `
	SELECT e.id, e.organizer_id, e.title, e.description, e.venue, e.starts_at,
	       e.currency, e.base_price_cents, e.status::text,
	       (SELECT COUNT(*) FROM seats s WHERE s.event_id = e.id)::int AS seat_count
	FROM events e`

func scanEvent(row pgx.Row) (*Event, error) {
	var e Event
	var startsAt time.Time
	if err := row.Scan(&e.ID, &e.OrganizerID, &e.Title, &e.Description, &e.Venue,
		&startsAt, &e.Currency, &e.BasePriceCents, &e.Status, &e.SeatCount); err != nil {
		return nil, err
	}
	e.StartsAt = iso(startsAt)
	e.Currency = strings.TrimSpace(e.Currency)
	return &e, nil
}

// ListEvents returns published events by default; an explicit status filter
// overrides that.
func (s *Service) ListEvents(ctx context.Context, page, pageSize int, status string) (*Page[Event], error) {
	args := []any{}
	where := "WHERE e.status = 'published'"
	if status != "" {
		args = append(args, status)
		where = "WHERE e.status::text = $1"
	}

	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM events e `+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	args = append(args, pageSize, page*pageSize)
	rows, err := s.pool.Query(ctx,
		eventSelect+" "+where+
			" ORDER BY e.starts_at ASC"+
			placeholderLimit(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	data := []Event{}
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		data = append(data, *e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &Page[Event]{Data: data, Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Service) GetEvent(ctx context.Context, eventID string) (*Event, error) {
	return s.getEvent(ctx, s.pool, eventID)
}

func (s *Service) getEvent(ctx context.Context, q store.Querier, eventID string) (*Event, error) {
	e, err := scanEvent(q.QueryRow(ctx, eventSelect+" WHERE e.id = $1", eventID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.New(apperr.EventNotFound, "Event not found")
		}
		return nil, err
	}
	return e, nil
}

var (
	validSections     = map[string]bool{"A": true, "B": true, "C": true, "D": true}
	validAvailability = map[string]bool{"available": true, "held": true, "sold": true}
)

// ListSeats returns the seat map for an event, optionally filtered by section
// and availability. Both filters are validated against a closed allowlist, so a
// hostile value is rejected with VALIDATION_ERROR rather than reaching SQL.
func (s *Service) ListSeats(
	ctx context.Context, eventID string, page, pageSize int, section, availability string,
) (*Page[Seat], error) {
	if _, err := s.GetEvent(ctx, eventID); err != nil {
		return nil, err
	}
	if section != "" && !validSections[section] {
		return nil, apperr.New(apperr.ValidationError, "Invalid section filter")
	}
	if availability != "" && !validAvailability[availability] {
		return nil, apperr.New(apperr.ValidationError, "Invalid availability filter")
	}

	args := []any{eventID}
	filters := []string{"event_id = $1"}
	if section != "" {
		args = append(args, section)
		filters = append(filters, "section = $"+itoa(len(args))+"::text::seat_section")
	}
	if availability != "" {
		args = append(args, availability)
		filters = append(filters, "status = $"+itoa(len(args))+"::text::seat_status")
	}
	where := "WHERE " + strings.Join(filters, " AND ")

	var total int
	if err := s.pool.QueryRow(ctx,
		"SELECT COUNT(*)::int FROM seats "+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.pool.Query(ctx,
		`SELECT id, event_id, section::text, row_label, number, status::text, price_cents
		 FROM seats `+where+
			" ORDER BY section, row_label, number"+
			placeholderLimit(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	data := []Seat{}
	for rows.Next() {
		var st Seat
		if err := rows.Scan(&st.ID, &st.EventID, &st.Section, &st.Row, &st.Number,
			&st.Status, &st.PriceCents); err != nil {
			return nil, err
		}
		data = append(data, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &Page[Seat]{Data: data, Page: page, PageSize: pageSize, Total: total}, nil
}

// placeholderLimit appends LIMIT/OFFSET for the last two bound args.
func placeholderLimit(n int) string {
	return " LIMIT $" + itoa(n-1) + " OFFSET $" + itoa(n)
}

func itoa(n int) string { return strconv.Itoa(n) }
