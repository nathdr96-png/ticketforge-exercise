// Package apperr implements the fixed TicketForge error envelope from
// contract/errors.md. Codes are closed: implementations MUST NOT invent new ones.
package apperr

import "net/http"

type Code string

const (
	Unauthenticated        Code = "UNAUTHENTICATED"
	InsufficientPermission Code = "INSUFFICIENT_PERMISSION"
	NotFound               Code = "NOT_FOUND"
	EventNotFound          Code = "EVENT_NOT_FOUND"
	SeatNotFound           Code = "SEAT_NOT_FOUND"
	HoldNotFound           Code = "HOLD_NOT_FOUND"
	OrderNotFound          Code = "ORDER_NOT_FOUND"
	ValidationError        Code = "VALIDATION_ERROR"
	SeatAlreadyHeld        Code = "SEAT_ALREADY_HELD"
	SeatNotAvailable       Code = "SEAT_NOT_AVAILABLE"
	HoldExpired            Code = "HOLD_EXPIRED"
	HoldAlreadyConverted   Code = "HOLD_ALREADY_CONVERTED"
	IdempotencyKeyRequired Code = "IDEMPOTENCY_KEY_REQUIRED"
	IdempotencyKeyConflict Code = "IDEMPOTENCY_KEY_CONFLICT"
	DiscountInvalid        Code = "DISCOUNT_INVALID"
	DiscountAlreadyApplied Code = "DISCOUNT_ALREADY_APPLIED"
	RateLimited            Code = "RATE_LIMITED"
	InternalError          Code = "INTERNAL_ERROR"
)

var status = map[Code]int{
	Unauthenticated:        http.StatusUnauthorized,
	InsufficientPermission: http.StatusForbidden,
	NotFound:               http.StatusNotFound,
	EventNotFound:          http.StatusNotFound,
	SeatNotFound:           http.StatusNotFound,
	HoldNotFound:           http.StatusNotFound,
	OrderNotFound:          http.StatusNotFound,
	ValidationError:        http.StatusBadRequest,
	SeatAlreadyHeld:        http.StatusConflict,
	SeatNotAvailable:       http.StatusConflict,
	HoldExpired:            http.StatusGone,
	HoldAlreadyConverted:   http.StatusConflict,
	IdempotencyKeyRequired: http.StatusBadRequest,
	IdempotencyKeyConflict: http.StatusConflict,
	DiscountInvalid:        http.StatusBadRequest,
	DiscountAlreadyApplied: http.StatusConflict,
	RateLimited:            http.StatusTooManyRequests,
	InternalError:          http.StatusInternalServerError,
}

// Error is an application error carrying a contract error code.
type Error struct {
	Code    Code
	Message string
	Details map[string]any
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }

// Status returns the HTTP status mandated by contract/errors.md for this code.
func (e *Error) Status() int {
	if s, ok := status[e.Code]; ok {
		return s
	}
	return http.StatusInternalServerError
}

type envelopeBody struct {
	Code    Code           `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

type envelope struct {
	Error envelopeBody `json:"error"`
}

// Envelope renders the wire representation: {"error":{"code","message","details"}}.
func (e *Error) Envelope() any {
	return envelope{Error: envelopeBody{Code: e.Code, Message: e.Message, Details: e.Details}}
}

// New builds an Error without details.
func New(code Code, message string) *Error {
	return &Error{Code: code, Message: message}
}

// WithDetails builds an Error carrying structured context.
func WithDetails(code Code, message string, details map[string]any) *Error {
	return &Error{Code: code, Message: message, Details: details}
}
