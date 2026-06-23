// Command ticketforge is the TicketForge backend, in Go.
//
//	ticketforge serve        start the HTTP API (default)
//	ticketforge migrate      apply contract/schema.sql
//	ticketforge seed         migrate, then load contract/seed/*.json
//	ticketforge healthcheck  probe GET /health (used by the container HEALTHCHECK)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"ticketforge/backend-go/internal/api"
	"ticketforge/backend-go/internal/auth"
	"ticketforge/backend-go/internal/config"
	"ticketforge/backend-go/internal/service"
	"ticketforge/backend-go/internal/store"
	"ticketforge/backend-go/internal/worker"
)

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	cfg := config.Load()
	log := newLogger(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, cmd, cfg, log); err != nil {
		log.Error("fatal", "command", cmd, "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cmd string, cfg config.Config, log *slog.Logger) error {
	switch cmd {
	case "healthcheck":
		return healthcheck(ctx, cfg.Port)
	case "migrate", "seed", "serve":
	default:
		return fmt.Errorf("unknown command %q (want serve, migrate, seed or healthcheck)", cmd)
	}

	pool, err := store.Open(ctx, cfg.DatabaseURL, cfg.MaxDBConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	switch cmd {
	case "migrate":
		return store.Migrate(ctx, pool, cfg.ContractDir)
	case "seed":
		return store.Seed(ctx, pool, cfg.ContractDir, cfg.BcryptCost)
	}

	svc := service.New(pool, cfg)
	authSvc := auth.New(pool, cfg.JWTSecret)
	server := api.NewServer(cfg, authSvc, svc, log)

	worker.StartHoldExpiry(ctx, svc, time.Duration(cfg.HoldExpiryTickMS)*time.Millisecond, log)

	srv := &http.Server{
		Addr:              net.JoinHostPort("0.0.0.0", strconv.Itoa(cfg.Port)),
		Handler:           server.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("TicketForge API listening",
			"addr", srv.Addr,
			"hold_ttl_seconds", cfg.HoldTTLSeconds,
			"fee_percent", cfg.FeePercent,
			"fee_fixed_cents", cfg.FeeFixedCents)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

// healthcheck probes GET /health so the container HEALTHCHECK needs no shell.
func healthcheck(ctx context.Context, port int) error {
	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/health"
	reqCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("health returned %d", res.StatusCode)
	}
	return nil
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch level {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
