# FEAT-26 — Discount code effectiveness report

- **Requested by:** Dana (Finance)
- **Type:** Feature
- **Affects:** analytics, promotions

## Context

We run promo codes and nobody can say what they cost us. Dana is asked for a
figure every quarter and currently produces it by exporting orders to a
spreadsheet and pivoting by code, which takes most of a morning and is wrong often
enough that she double-checks it.

Marketing wants something out of the same report: which codes have been printed,
mailed or handed out and are not being redeemed at all. Those are the ones they
want to stop paying to promote.

The report currently exists as a placeholder that returns a row per code with
every figure zeroed. It needs to actually answer the question.

## What we want

One report that says, for each promo code, how much business it brought in and how
much we gave away to get it — and that still lists the codes nobody used.

## Acceptance criteria

1. Every code in our discounts table appears, including inactive codes and codes
   that have never been redeemed. Marketing's half of the question is specifically
   about the codes with no activity, so a code must not be able to drop out of the
   report by not being used.
2. For each code, report how many orders used it, the face value of those orders,
   the amount discounted, the booking fees on them, and the amount actually
   collected. The definitions of those five figures are the ones already written
   down in the reporting contract; do not invent a second set.
3. Only completed sales count. A refunded order did not bring in business.
4. A code that has been redeemed against events in more than one currency is
   reported per currency. We have at least one code in that situation, and adding
   those amounts together would be meaningless.
5. A code with no redemptions is reported exactly once, with no currency attached
   and every figure zero — not omitted, and not with a currency guessed from
   somewhere.
6. The report also carries each code's percentage and whether it is currently
   active, so Marketing can read it without joining to anything else.
7. All amounts are integer minor units. No floating-point arithmetic anywhere near
   money.
8. The report has a defined, stable order so that two runs can be diffed.

## Out of scope

- Creating, editing or deactivating codes
- Attributing a sale to a code the buyer did not enter
- Any forecast of what a code *would* have earned

## Definition of done

- The acceptance criteria above hold.
- The amount this report says was given away agrees, per currency, with the
  discount figure in the per-event revenue report. Dana will check this first.
- The reporting contract's definitions and output rules are respected exactly —
  read them before you start.
