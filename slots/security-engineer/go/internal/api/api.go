// Package api wires the REST surface described by contract/openapi.yaml onto
// the stdlib net/http router.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"ticketforge/backend-go/internal/apperr"
	"ticketforge/backend-go/internal/auth"
	"ticketforge/backend-go/internal/config"
	"ticketforge/backend-go/internal/service"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
	maxBodyBytes    = 1 << 20
)

type Server struct {
	cfg  config.Config
	auth *auth.Service
	svc  *service.Service
	log  *slog.Logger
}

func NewServer(cfg config.Config, authSvc *auth.Service, svc *service.Service, log *slog.Logger) *Server {
	return &Server{cfg: cfg, auth: authSvc, svc: svc, log: log}
}

// handler returns (status, body, error). A nil body with status 204 writes no
// content.
type handler func(w http.ResponseWriter, r *http.Request) (int, any, error)

type userCtxKey struct{}

func userOf(r *http.Request) *auth.User {
	u, _ := r.Context().Value(userCtxKey{}).(*auth.User)
	return u
}

// Routes builds the mux.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /health", s.wrap(s.health))
	mux.Handle("GET /", s.wrap(s.root))
	mux.Handle("POST /auth/login", s.wrap(s.login))

	mux.Handle("GET /events", s.wrap(s.requireAuth(s.listEvents)))
	mux.Handle("GET /events/{eventId}", s.wrap(s.requireAuth(s.getEvent)))
	mux.Handle("GET /events/{eventId}/seats", s.wrap(s.requireAuth(s.listSeats)))

	mux.Handle("POST /holds", s.wrap(s.requireAuth(s.createHold)))
	mux.Handle("GET /holds/{holdId}", s.wrap(s.requireAuth(s.getHold)))
	mux.Handle("DELETE /holds/{holdId}", s.wrap(s.requireAuth(s.releaseHold)))

	mux.Handle("POST /orders", s.wrap(s.requireAuth(s.createOrder)))
	mux.Handle("GET /orders/{orderId}", s.wrap(s.requireAuth(s.getOrder)))

	mux.Handle("GET /reports/revenue", s.wrap(s.requireAuth(s.revenueReport)))

	return s.cors(mux)
}

// cors keeps the browser slots able to call this API directly.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// wrap turns a handler into an http.Handler, rendering the contract error
// envelope for every failure path.
func (s *Server) wrap(h handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status, body, err := h(w, r)
		if err != nil {
			var ae *apperr.Error
			if !errors.As(err, &ae) {
				s.log.Error("unhandled error", "method", r.Method, "path", r.URL.Path, "err", err)
				ae = apperr.New(apperr.InternalError, "Internal server error")
			}
			writeJSON(w, ae.Status(), ae.Envelope())
			return
		}
		if status == http.StatusNoContent || body == nil {
			w.WriteHeader(status)
			return
		}
		writeJSON(w, status, body)
	})
}

// requireAuth enforces a valid bearer token and loads the caller.
func (s *Server) requireAuth(next handler) handler {
	return func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			return 0, nil, apperr.New(apperr.Unauthenticated, "Authentication required")
		}
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		if token == "" {
			return 0, nil, apperr.New(apperr.Unauthenticated, "Authentication required")
		}
		user, err := s.auth.Authenticate(r.Context(), token)
		if err != nil {
			return 0, nil, err
		}
		return next(w, r.WithContext(context.WithValue(r.Context(), userCtxKey{}, user)))
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	buf, err := json.Marshal(body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"code":"INTERNAL_ERROR","message":"Serialization failure"}}`))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buf)
}

func decodeBody(r *http.Request, out any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, maxBodyBytes))
	if err := dec.Decode(out); err != nil {
		if errors.Is(err, io.EOF) {
			return nil // empty body: let per-field validation report it
		}
		return apperr.New(apperr.ValidationError, "Malformed JSON body")
	}
	return nil
}

func pagination(r *http.Request) (page, pageSize int) {
	page = 1
	if v, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && v > 1 {
		page = v
	}
	pageSize = defaultPageSize
	if v, err := strconv.Atoi(r.URL.Query().Get("page_size")); err == nil {
		pageSize = v
	}
	if pageSize < 1 {
		pageSize = 1
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}

// ---- handlers ----

func (s *Server) health(_ http.ResponseWriter, _ *http.Request) (int, any, error) {
	return http.StatusOK, map[string]string{"status": "ok"}, nil
}

func (s *Server) root(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	if r.URL.Path != "/" {
		return 0, nil, apperr.New(apperr.NotFound, "Route not found")
	}
	return http.StatusOK, map[string]string{
		"name":   "TicketForge API",
		"status": "ok",
		"health": "/health",
		"docs":   "See contract/openapi.yaml",
		"login":  "POST /auth/login",
		"stack":  "Go " + "net/http + pgx",
	}, nil
}

func (s *Server) login(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeBody(r, &body); err != nil {
		return 0, nil, err
	}
	if body.Email == "" || body.Password == "" {
		return 0, nil, apperr.New(apperr.ValidationError, "email and password required")
	}
	res, err := s.auth.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, res, nil
}

func (s *Server) listEvents(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	page, pageSize := pagination(r)
	res, err := s.svc.ListEvents(r.Context(), page, pageSize, r.URL.Query().Get("status"))
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, res, nil
}

func (s *Server) getEvent(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	res, err := s.svc.GetEvent(r.Context(), r.PathValue("eventId"))
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, res, nil
}

func (s *Server) listSeats(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	page, pageSize := pagination(r)
	q := r.URL.Query()
	res, err := s.svc.ListSeats(r.Context(), r.PathValue("eventId"), page, pageSize,
		q.Get("section"), q.Get("availability"))
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, res, nil
}

func (s *Server) createHold(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	var body struct {
		EventID string   `json:"event_id"`
		SeatIDs []string `json:"seat_ids"`
	}
	if err := decodeBody(r, &body); err != nil {
		return 0, nil, err
	}
	if body.EventID == "" || body.SeatIDs == nil {
		return 0, nil, apperr.New(apperr.ValidationError, "event_id and seat_ids required")
	}
	hold, err := s.svc.CreateHold(r.Context(), userOf(r), body.EventID, body.SeatIDs)
	if err != nil {
		return 0, nil, err
	}
	return http.StatusCreated, hold, nil
}

func (s *Server) getHold(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	hold, err := s.svc.GetHold(r.Context(), userOf(r), r.PathValue("holdId"))
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, hold, nil
}

func (s *Server) releaseHold(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	if err := s.svc.ReleaseHold(r.Context(), userOf(r), r.PathValue("holdId")); err != nil {
		return 0, nil, err
	}
	return http.StatusNoContent, nil, nil
}

func (s *Server) createOrder(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	var body service.OrderRequest
	if err := decodeBody(r, &body); err != nil {
		return 0, nil, err
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	order, replay, err := s.svc.CreateOrder(r.Context(), userOf(r), key, body)
	if err != nil {
		return 0, nil, err
	}
	if replay {
		return http.StatusOK, order, nil
	}
	return http.StatusCreated, order, nil
}

func (s *Server) getOrder(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	order, err := s.svc.GetOrder(r.Context(), userOf(r), r.PathValue("orderId"))
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, order, nil
}

func (s *Server) revenueReport(_ http.ResponseWriter, r *http.Request) (int, any, error) {
	q := r.URL.Query()
	res, err := s.svc.RevenueReport(r.Context(), userOf(r), service.RevenueFilters{
		EventID: q.Get("event_id"),
		From:    q.Get("from"),
		To:      q.Get("to"),
	})
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, res, nil
}
