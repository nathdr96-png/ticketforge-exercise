"""Runtime configuration + the canonical money math.

Money is *always* integer minor units (cents). Nothing on the money path is
allowed to become a float, so every computation here uses Python ints and
floor division (``//``) only.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# slots/backend-developer/python-fastapi/app/config.py -> repo root is 5 levels up
REPO_ROOT = Path(__file__).resolve().parents[4]
CONTRACT_DIR = Path(os.environ.get("CONTRACT_DIR") or (REPO_ROOT / "contract"))


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


@dataclass(frozen=True)
class Config:
    port: int
    database_url: str
    jwt_secret: str
    jwt_ttl_seconds: int
    hold_ttl_seconds: int
    fee_percent: int
    fee_fixed_cents: int
    log_level: str
    hold_expiry_interval_ms: int

    @property
    def contract_dir(self) -> Path:
        return CONTRACT_DIR

    @property
    def schema_sql(self) -> Path:
        return CONTRACT_DIR / "schema.sql"

    @property
    def seed_dir(self) -> Path:
        return CONTRACT_DIR / "seed"


config = Config(
    port=_int_env("PORT", 3000),
    database_url=os.environ.get("DATABASE_URL")
    or "postgres://ticketforge:ticketforge@localhost:5432/ticketforge",
    jwt_secret=os.environ.get("JWT_SECRET") or "ticketforge-dev-secret-change-me",
    jwt_ttl_seconds=_int_env("JWT_TTL_SECONDS", 12 * 60 * 60),
    hold_ttl_seconds=_int_env("HOLD_TTL_SECONDS", 600),
    fee_percent=_int_env("FEE_PERCENT", 5),
    fee_fixed_cents=_int_env("FEE_FIXED_CENTS", 30),
    log_level=(os.environ.get("LOG_LEVEL") or "info").lower(),
    hold_expiry_interval_ms=_int_env("HOLD_EXPIRY_INTERVAL_MS", 1000),
)


def compute_fee_cents(subtotal_after_discount_cents: int) -> int:
    """fee_cents = floor(subtotal_after_discount * FEE_PERCENT / 100) + FEE_FIXED_CENTS."""
    subtotal = int(subtotal_after_discount_cents)
    return (subtotal * config.fee_percent) // 100 + config.fee_fixed_cents


def compute_discount_cents(subtotal_cents: int, percent_off: int) -> int:
    """discount_cents = floor(subtotal * percent_off / 100)."""
    return (int(subtotal_cents) * int(percent_off)) // 100
