"""Pydantic request/response models.

Request bodies are validated *explicitly* inside the handlers (after the auth
dependency has run) so that an unauthenticated request with a malformed body
still answers ``401 UNAUTHENTICATED``: authentication runs before schema
validation, which is the order contract/openapi.yaml's error responses assume.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .errors import AppError

Role = Literal["admin", "organizer", "buyer"]
Currency = Literal["USD", "EUR", "GBP"]
Section = Literal["A", "B", "C", "D"]
EventStatus = Literal["draft", "published", "cancelled"]
SeatStatus = Literal["available", "held", "sold"]
HoldStatus = Literal["active", "expired", "released", "converted"]
OrderStatus = Literal["paid", "refunded"]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str
    password: str


class CreateHoldRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: str
    seat_ids: list[str] = Field(min_length=1, max_length=10)


class CreateOrderRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    hold_id: str
    discount_code: str | None = None


class User(BaseModel):
    # New profile columns reach clients without a model change.
    model_config = ConfigDict(extra="allow")

    id: str
    email: str
    role: Role
    name: str


class LoginResponse(BaseModel):
    token: str
    user: User


class Event(BaseModel):
    id: str
    organizer_id: str
    title: str
    description: str
    venue: str
    starts_at: str
    currency: Currency
    base_price_cents: int
    status: EventStatus
    seat_count: int


class EventList(BaseModel):
    data: list[Event]
    page: int
    page_size: int
    total: int


class Seat(BaseModel):
    id: str
    event_id: str
    section: Section
    row: str
    number: int
    status: SeatStatus
    price_cents: int


class SeatList(BaseModel):
    data: list[Seat]
    page: int
    page_size: int
    total: int


class Hold(BaseModel):
    id: str
    event_id: str
    buyer_id: str
    seat_ids: list[str]
    status: HoldStatus
    expires_at: str
    created_at: str


class Order(BaseModel):
    id: str
    hold_id: str
    buyer_id: str
    event_id: str
    seat_ids: list[str]
    subtotal_cents: int
    fee_cents: int
    discount_cents: int
    total_cents: int
    currency: Currency
    discount_code: str | None = None
    status: OrderStatus
    created_at: str


class RevenueByEvent(BaseModel):
    event_id: str
    order_count: int
    gross_cents: int
    net_cents: int


class RevenueReport(BaseModel):
    currency: str
    gross_cents: int
    fees_cents: int
    discounts_cents: int
    net_cents: int
    by_event: list[RevenueByEvent]


class HealthResponse(BaseModel):
    status: Literal["ok"]


def parse_body[T: BaseModel](model: type[T], payload: Any, message: str) -> T:
    """Validate a decoded JSON body, converting failures to VALIDATION_ERROR."""
    if not isinstance(payload, dict):
        raise AppError("VALIDATION_ERROR", message)
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise AppError(
            "VALIDATION_ERROR",
            message,
            {"fields": [".".join(str(p) for p in e["loc"]) for e in exc.errors()]},
        ) from exc
