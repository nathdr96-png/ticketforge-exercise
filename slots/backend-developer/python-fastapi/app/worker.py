"""Background hold-expiry worker.

Runs inside the API process and sweeps active holds past
``expires_at``, releasing their seats back to ``available``.
"""

from __future__ import annotations

import asyncio
import logging

from .config import config
from .service import expire_due_holds

log = logging.getLogger("ticketforge.worker")


async def _loop(interval_seconds: float) -> None:
    while True:
        try:
            await expire_due_holds(100)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - worker must never die
            log.exception("hold expiry worker error")
        await asyncio.sleep(interval_seconds)


def start_hold_expiry_worker(interval_ms: int | None = None) -> asyncio.Task[None]:
    interval = (interval_ms if interval_ms is not None else config.hold_expiry_interval_ms) / 1000
    return asyncio.create_task(_loop(interval), name="hold-expiry-worker")
