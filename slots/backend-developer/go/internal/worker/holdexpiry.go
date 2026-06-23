// Package worker holds background jobs.
package worker

import (
	"context"
	"log/slog"
	"time"

	"ticketforge/backend-go/internal/service"
)

// StartHoldExpiry runs the hold-expiry sweep until ctx is cancelled. Holds past
// their TTL are marked expired and their seats returned to 'available', so a
// buyer who abandons a checkout does not strand inventory.
func StartHoldExpiry(ctx context.Context, svc *service.Service, interval time.Duration, log *slog.Logger) {
	if interval <= 0 {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		tick := func() {
			tickCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			if n, err := svc.ExpireDueHolds(tickCtx, 100); err != nil {
				if ctx.Err() == nil {
					log.Warn("hold expiry sweep failed", "err", err)
				}
			} else if n > 0 {
				log.Info("expired holds", "count", n)
			}
		}
		tick()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				tick()
			}
		}
	}()
}
