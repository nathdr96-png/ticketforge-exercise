"""HTTP surface — mirrors contract/openapi.yaml.

Request bodies are read as raw JSON and validated explicitly so the ordering of
failures is exact (auth before validation, and
``IDEMPOTENCY_KEY_REQUIRED`` before body validation on ``POST /orders``).
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from . import service as svc
from .auth import AuthUser, load_user, login, verify_token
from .errors import AppError
from .models import (
    CreateHoldRequest,
    CreateOrderRequest,
    EventList,
    HealthResponse,
    Hold,
    LoginRequest,
    LoginResponse,
    Order,
    RevenueReport,
    SeatList,
    parse_body,
)
from .models import Event as EventModel

router = APIRouter()

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


async def read_json(request: Request) -> Any:
    raw = await request.body()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise AppError("VALIDATION_ERROR", "Request body must be valid JSON") from exc


async def require_auth(request: Request) -> AuthUser:
    header = request.headers.get("authorization")
    if not header or not header.startswith("Bearer "):
        raise AppError("UNAUTHENTICATED", "Authentication required")
    payload = verify_token(header[7:])
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise AppError("UNAUTHENTICATED", "Invalid or expired token")
    return await load_user(subject)


CurrentUser = Annotated[AuthUser, Depends(require_auth)]


def _int_param(raw: str | None, default: int, lo: int, hi: int) -> int:
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise AppError("VALIDATION_ERROR", "Pagination parameters must be integers") from exc
    return min(hi, max(lo, value))


def _pagination(request: Request) -> tuple[int, int]:
    q = request.query_params
    page = _int_param(q.get("page"), 1, 1, 1_000_000_000)
    page_size = _int_param(q.get("page_size"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
    return page, page_size


# --------------------------------------------------------------------------- #
# health + root
# --------------------------------------------------------------------------- #


@router.get("/health", response_model=HealthResponse, tags=["health"])
async def get_health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {
        "name": "TicketForge API",
        "status": "ok",
        "health": "/health",
        "docs": "See contract/openapi.yaml",
        "login": "POST /auth/login",
    }


# --------------------------------------------------------------------------- #
# auth
# --------------------------------------------------------------------------- #


@router.post("/auth/login", response_model=LoginResponse, tags=["auth"])
async def post_login(request: Request) -> dict[str, Any]:
    payload = await read_json(request)
    if not isinstance(payload, dict) or not payload.get("email") or not payload.get("password"):
        raise AppError("VALIDATION_ERROR", "email and password required")
    body = parse_body(LoginRequest, payload, "email and password required")
    return await login(body.email, body.password)


# --------------------------------------------------------------------------- #
# events
# --------------------------------------------------------------------------- #


@router.get("/events", response_model=EventList, tags=["events"])
async def get_events(request: Request, user: CurrentUser) -> dict[str, Any]:
    page, page_size = _pagination(request)
    return await svc.list_events(page, page_size, request.query_params.get("status"))


@router.get("/events/{event_id}", response_model=EventModel, tags=["events"])
async def get_event(event_id: str, user: CurrentUser) -> dict[str, Any]:
    return await svc.get_event(event_id)


@router.get("/events/{event_id}/seats", response_model=SeatList, tags=["events"])
async def get_event_seats(event_id: str, request: Request, user: CurrentUser) -> dict[str, Any]:
    page, page_size = _pagination(request)
    q = request.query_params
    return await svc.list_seats(event_id, page, page_size, q.get("section"), q.get("availability"))


# --------------------------------------------------------------------------- #
# holds
# --------------------------------------------------------------------------- #


@router.post("/holds", response_model=Hold, status_code=201, tags=["holds"])
async def post_holds(request: Request, user: CurrentUser) -> dict[str, Any]:
    payload = await read_json(request)
    body = parse_body(CreateHoldRequest, payload, "event_id and seat_ids required")
    return await svc.create_hold(user, body.event_id, body.seat_ids)


@router.get("/holds/{hold_id}", response_model=Hold, tags=["holds"])
async def get_hold(hold_id: str, user: CurrentUser) -> dict[str, Any]:
    return await svc.get_hold(user, hold_id)


@router.delete("/holds/{hold_id}", status_code=204, tags=["holds"])
async def delete_hold(hold_id: str, user: CurrentUser) -> Response:
    await svc.release_hold(user, hold_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# orders
# --------------------------------------------------------------------------- #


@router.post("/orders", response_model=Order, tags=["orders"])
async def post_orders(request: Request, user: CurrentUser) -> Response:
    idempotency_key = request.headers.get("idempotency-key")
    payload = await read_json(request)
    if not idempotency_key or len(idempotency_key) < 8:
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required")
    body = parse_body(CreateOrderRequest, payload, "hold_id required")
    order, replay = await svc.create_order(
        user, idempotency_key, {"hold_id": body.hold_id, "discount_code": body.discount_code}
    )
    return JSONResponse(status_code=200 if replay else 201, content=order)


@router.get("/orders/{order_id}", response_model=Order, tags=["orders"])
async def get_order(order_id: str, user: CurrentUser) -> dict[str, Any]:
    return await svc.get_order(user, order_id)


# --------------------------------------------------------------------------- #
# reports
# --------------------------------------------------------------------------- #


@router.get("/reports/revenue", response_model=RevenueReport, tags=["reports"])
async def get_revenue(request: Request, user: CurrentUser) -> dict[str, Any]:
    q = request.query_params
    return await svc.revenue_report(
        user,
        {"event_id": q.get("event_id"), "from": q.get("from"), "to": q.get("to")},
    )
