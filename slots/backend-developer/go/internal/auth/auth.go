// Package auth implements password login and bearer-token verification.
package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"ticketforge/backend-go/internal/apperr"
)

const tokenTTL = 12 * time.Hour

// User is the authenticated principal, as stored in the users table.
type User struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	Name         string `json:"name"`
	PasswordHash string
}

const (
	RoleAdmin     = "admin"
	RoleOrganizer = "organizer"
	RoleBuyer     = "buyer"
)

type Service struct {
	pool   *pgxpool.Pool
	secret string
}

func New(pool *pgxpool.Pool, secret string) *Service {
	return &Service{pool: pool, secret: secret}
}

type LoginResult struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

// Login verifies the password with bcrypt and returns a signed JWT. Unknown
// email and wrong password are indistinguishable to the caller.
func (s *Service) Login(ctx context.Context, email, password string) (*LoginResult, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`SELECT id, email, role::text, name, password_hash FROM users WHERE email = $1`,
		email).Scan(&u.ID, &u.Email, &u.Role, &u.Name, &u.PasswordHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Still spend time comparing so timing does not leak existence.
			_ = bcrypt.CompareHashAndPassword(
				[]byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"),
				[]byte(password))
			return nil, apperr.New(apperr.Unauthenticated, "Invalid email or password")
		}
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, apperr.New(apperr.Unauthenticated, "Invalid email or password")
	}

	token, err := SignToken(s.secret, u.ID, u.Role, tokenTTL)
	if err != nil {
		return nil, err
	}
	return &LoginResult{Token: token, User: u}, nil
}

// Authenticate verifies a bearer token and loads the current user record, so
// role changes take effect without waiting for the token to expire.
func (s *Service) Authenticate(ctx context.Context, bearer string) (*User, error) {
	sub, _, err := VerifyToken(s.secret, bearer)
	if err != nil {
		return nil, apperr.New(apperr.Unauthenticated, "Invalid or expired token")
	}
	var u User
	err = s.pool.QueryRow(ctx,
		`SELECT id, email, role::text, name FROM users WHERE id = $1`, sub).
		Scan(&u.ID, &u.Email, &u.Role, &u.Name)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.New(apperr.Unauthenticated, "User not found")
		}
		return nil, err
	}
	return &u, nil
}
