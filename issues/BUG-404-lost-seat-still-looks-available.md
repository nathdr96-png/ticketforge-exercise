# BUG-404 — A seat someone else just took still looks available on the map

- **Reported by:** Noor (Customer Success)
- **Severity:** S2 — customers repeat a failing action and blame us
- **Affects:** seat map

## What happened

On busy on-sales, two customers often click the same seat seconds apart. The one
who loses is told the seat is already held — that part is right and the message is
clear. The problem is that the seat is still drawn as available afterwards, so the
customer tries it again, gets the same refusal, tries again, and after three or
four attempts writes in to say the site is broken.

One customer sent a screenshot: the error message naming the seat is on screen at
the same time as the seat, still green and still clickable.

## Steps to reproduce

1. In one browser, sign in as `buyer01@ticketforge.test` and open Riverside
   Arena. Leave the seat map open.
2. In a second browser, sign in as `buyer02@ticketforge.test`, open the same
   event, and hold seat `B02-01`.
3. Back in the first browser — without reloading — click `B02-01` and try to hold
   it.

Expected: the refusal explains what happened, and the map now shows that seat as
held so the customer looks elsewhere.
Actual: the refusal appears, but the seat is unchanged on the map. Only a full
page reload shows its real state.

## Notes

The seat map does catch up after a *successful* hold — it is specifically the
rejected case that leaves stale state on screen. The counts in the toolbar are
stale too.

## Definition of done

- After a hold is refused, the map reflects the seats' actual current state.
- The seat that was lost is no longer offered as available or clickable.
- A regression test covers the losing side of a race, not just the error message.
