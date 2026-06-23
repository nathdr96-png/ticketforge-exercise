"""FastAPI application factory.

Every error path — AppError, framework validation, HTTP exceptions raised by
Starlette's router, and unhandled exceptions — is funnelled through an
exception handler so the response body is *always* the contract envelope from
contract/errors.md. FastAPI's native 422 shape never reaches the wire.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import config
from .db import close_pool, open_pool
from .errors import AppError, error_body
from .routes import router
from .worker import start_hold_expiry_worker

log = logging.getLogger("ticketforge")

STATUS_TO_CODE: dict[int, str] = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHENTICATED",
    403: "INSUFFICIENT_PERMISSION",
    404: "NOT_FOUND",
    405: "NOT_FOUND",
    409: "VALIDATION_ERROR",
    410: "HOLD_EXPIRED",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}


def _json_error(status: int, code: str, message: str, details: dict[str, Any] | None = None):
    return JSONResponse(status_code=status, content=error_body(code, message, details))


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await open_pool()
    worker = start_hold_expiry_worker()
    try:
        yield
    finally:
        worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker
        await close_pool()


def create_app() -> FastAPI:
    logging.basicConfig(level=getattr(logging, config.log_level.upper(), logging.INFO))

    app = FastAPI(
        title="TicketForge API",
        version="1.0.0",
        description="Event ticketing with time-limited seat holds (Python/FastAPI slot).",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.exception_handler(AppError)
    async def _app_error(_request: Request, exc: AppError):
        return JSONResponse(status_code=exc.status, content=exc.to_json())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError):
        fields = [".".join(str(p) for p in e.get("loc", ())) for e in exc.errors()]
        return _json_error(400, "VALIDATION_ERROR", "Invalid request", {"fields": fields})

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException):
        code = STATUS_TO_CODE.get(exc.status_code, "INTERNAL_ERROR")
        detail = exc.detail if isinstance(exc.detail, str) and exc.detail else code
        return _json_error(exc.status_code, code, detail)

    @app.exception_handler(Exception)
    async def _unhandled(_request: Request, exc: Exception):
        log.exception("unhandled error", exc_info=exc)
        return _json_error(500, "INTERNAL_ERROR", "Internal server error")

    return app


app = create_app()
