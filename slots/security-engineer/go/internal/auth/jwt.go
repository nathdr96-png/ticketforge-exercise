package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Minimal HS256 JWT. TicketForge both issues and verifies its own tokens, so a
// single algorithm with no "alg" negotiation is the safe choice: tokens signed
// with anything else (including "none") are rejected outright.

var errInvalidToken = errors.New("invalid token")

type claims struct {
	Sub  string `json:"sub"`
	Role string `json:"role"`
	Iat  int64  `json:"iat"`
	Exp  int64  `json:"exp"`
}

type header struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func sign(secret, signingInput string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	return b64(mac.Sum(nil))
}

// SignToken issues a token for a user id and role, valid for ttl.
func SignToken(secret, sub, role string, ttl time.Duration) (string, error) {
	now := time.Now().UTC()
	h, err := json.Marshal(header{Alg: "HS256", Typ: "JWT"})
	if err != nil {
		return "", err
	}
	c, err := json.Marshal(claims{
		Sub:  sub,
		Role: role,
		Iat:  now.Unix(),
		Exp:  now.Add(ttl).Unix(),
	})
	if err != nil {
		return "", err
	}
	signingInput := b64(h) + "." + b64(c)
	return signingInput + "." + sign(secret, signingInput), nil
}

// VerifyToken validates signature, algorithm and expiry, returning the claims.
func VerifyToken(secret, token string) (sub string, role string, err error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", "", errInvalidToken
	}
	signingInput := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(sign(secret, signingInput)), []byte(parts[2])) {
		return "", "", errInvalidToken
	}

	hRaw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", "", errInvalidToken
	}
	var h header
	if err := json.Unmarshal(hRaw, &h); err != nil || h.Alg != "HS256" {
		return "", "", errInvalidToken
	}

	cRaw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", errInvalidToken
	}
	var c claims
	if err := json.Unmarshal(cRaw, &c); err != nil {
		return "", "", errInvalidToken
	}
	if c.Sub == "" {
		return "", "", errInvalidToken
	}
	if c.Exp != 0 && time.Now().UTC().Unix() >= c.Exp {
		return "", "", errInvalidToken
	}
	return c.Sub, c.Role, nil
}
