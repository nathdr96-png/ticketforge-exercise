"""The single error envelope defined by contract/errors.md.

Every error response produced by this service — including framework-level
validation failures and unhandled exceptions — is rendered through
``AppError.to_json()`` so the wire shape is always::

    {"error": {"code": "...", "message": "...", "details": {...}}}
"""

from __future__ import annotations

from typing import Any, Final

ErrorCode = str

STATUS_BY_CODE: Final[dict[str, int]] = {
    "UNAUTHENTICATED": 401,
    "INSUFFICIENT_PERMISSION": 403,
    "NOT_FOUND": 404,
    "EVENT_NOT_FOUND": 404,
    "SEAT_NOT_FOUND": 404,
    "HOLD_NOT_FOUND": 404,
    "ORDER_NOT_FOUND": 404,
    "VALIDATION_ERROR": 400,
    "SEAT_ALREADY_HELD": 409,
    "SEAT_NOT_AVAILABLE": 409,
    "HOLD_EXPIRED": 410,
    "HOLD_ALREADY_CONVERTED": 409,
    "IDEMPOTENCY_KEY_REQUIRED": 400,
    "IDEMPOTENCY_KEY_CONFLICT": 409,
    "DISCOUNT_INVALID": 400,
    "DISCOUNT_ALREADY_APPLIED": 409,
    "RATE_LIMITED": 429,
    "INTERNAL_ERROR": 500,
}


class AppError(Exception):
    """A contract error code plus its mandated HTTP status."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        if code not in STATUS_BY_CODE:
            raise ValueError(f"unknown error code: {code}")
        self.code = code
        self.message = message
        self.status = STATUS_BY_CODE[code]
        self.details = details

    def to_json(self) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            body["details"] = self.details
        return {"error": body}


def error_body(
    code: ErrorCode,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return AppError(code, message, details).to_json()
