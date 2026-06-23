package service

import (
	"context"
	"strings"

	"ticketforge/backend-go/internal/apperr"
	"ticketforge/backend-go/internal/auth"
)

type RevenueByEvent struct {
	EventID    string `json:"event_id"`
	OrderCount int    `json:"order_count"`
	GrossCents int    `json:"gross_cents"`
	NetCents   int    `json:"net_cents"`
}

type Revenue struct {
	Currency       string           `json:"currency"`
	GrossCents     int              `json:"gross_cents"`
	FeesCents      int              `json:"fees_cents"`
	DiscountsCents int              `json:"discounts_cents"`
	NetCents       int              `json:"net_cents"`
	ByEvent        []RevenueByEvent `json:"by_event"`
}

// RevenueFilters are the optional query parameters.
type RevenueFilters struct {
	EventID string
	From    string
	To      string
}

// RevenueReport is organizer-only (admins may read everything). An organizer
// only ever sees their own events.
func (s *Service) RevenueReport(
	ctx context.Context, user *auth.User, f RevenueFilters,
) (*Revenue, error) {
	if user.Role != auth.RoleOrganizer && user.Role != auth.RoleAdmin {
		return nil, apperr.New(apperr.InsufficientPermission, "Organizer role required")
	}

	args := []any{}
	clauses := []string{"o.status = 'paid'"}

	if user.Role == auth.RoleOrganizer {
		args = append(args, user.ID)
		clauses = append(clauses, "e.organizer_id = $"+itoa(len(args)))
	}
	if f.EventID != "" {
		args = append(args, f.EventID)
		clauses = append(clauses, "o.event_id = $"+itoa(len(args)))
	}
	if f.From != "" {
		args = append(args, f.From)
		clauses = append(clauses, "o.created_at >= $"+itoa(len(args))+"::timestamptz")
	}
	if f.To != "" {
		args = append(args, f.To)
		clauses = append(clauses, "o.created_at <= $"+itoa(len(args))+"::timestamptz")
	}

	rows, err := s.pool.Query(ctx, `
		SELECT o.event_id,
		       COUNT(*)::int                           AS order_count,
		       COALESCE(SUM(o.subtotal_cents),0)::int  AS gross_cents,
		       COALESCE(SUM(o.fee_cents),0)::int       AS fees_cents,
		       COALESCE(SUM(o.discount_cents),0)::int  AS discounts_cents,
		       COALESCE(SUM(o.total_cents),0)::int     AS net_cents,
		       MIN(e.currency)                         AS currency
		FROM orders o
		JOIN events e ON e.id = o.event_id
		WHERE `+strings.Join(clauses, " AND ")+`
		GROUP BY o.event_id
		ORDER BY o.event_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := &Revenue{Currency: "USD", ByEvent: []RevenueByEvent{}}
	first := true
	for rows.Next() {
		var (
			eventID                            string
			orderCount, gross, fees, disc, net int
			currency                           string
		)
		if err := rows.Scan(&eventID, &orderCount, &gross, &fees, &disc, &net, &currency); err != nil {
			return nil, err
		}
		if first {
			out.Currency = strings.TrimSpace(currency)
			first = false
		}
		out.GrossCents += gross
		out.FeesCents += fees
		out.DiscountsCents += disc
		out.NetCents += net
		out.ByEvent = append(out.ByEvent, RevenueByEvent{
			EventID:    eventID,
			OrderCount: orderCount,
			GrossCents: gross,
			NetCents:   net,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
