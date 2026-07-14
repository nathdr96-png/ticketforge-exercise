# FEAT-1112 — The scanner must verify that a ticket's own details have not been edited

- **Requested by:** Sam (Product)
- **Type:** Feature
- **Affects:** turnstile scanner, ticket integrity

## Context

Three of our venues have now reported the same thing: tickets being presented on
a second night. The barcode is a real one — it decodes to a seat we sold — but the
dates in it are not the dates we issued it with.

Every ticket we print carries, in the barcode, the identifiers and the window it
admits during, plus a short check value computed over all of it. A ticket whose
details have been edited will not match its own check value. The scanner reads
all of that today and uses the details, but it does not look at the check value
at all, so an edited ticket is indistinguishable from an issued one.

Marketing's reseller programme makes this urgent rather than theoretical: we are
about to start handing tickets to third parties who print them themselves.

## What we want

A ticket whose details do not match its own check value is refused at the door,
for a reason the staff can read, before anything else about it is considered.

## Acceptance criteria

1. A ticket whose check value does not match the rest of its fields is refused,
   with the refusal reason the contract declares for it.
2. The check is made **before** the device considers which event the ticket is
   for, whether it has been used, or what time it is. We do not act on fields we
   have not established are ours.
3. A ticket whose admission window has been widened — the identifiers untouched,
   only the dates moved — is refused. This is the specific case the venues
   reported and it must have a test of its own.
4. Every ticket we actually issued still gets in. The check value, the fields it
   covers, and the exact way it is computed are all written down in
   `contract/scanner/interface.yaml`; use that definition and do not invent a
   second one, because the printer and three devices in two other languages have
   to agree with it byte for byte.
5. The device holds no ticket database and must not need one. It is offline; the
   check has to be computable from the ticket alone.
6. A ticket that cannot be read at all is still refused as unreadable rather than
   as failing the check — the two reasons mean different things to the person on
   the door.

## Out of scope

- Issuing or reprinting tickets
- Any change to what we print on a ticket
- Revoking an individual ticket after issue

## Definition of done

- The acceptance criteria above hold.
- `contract/scanner/` is respected exactly; read it before you start, including
  its note on what this check value is and is **not**. It is a fixture, not a
  security control, and the note says what a real product would use instead.
