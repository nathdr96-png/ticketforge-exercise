# BUG-524 — Hold conversion rate is implausibly high

- **Reported by:** Marcus (Venue Operations)
- **Severity:** S2 — we are about to make a decision on this number
- **Affects:** analytics, hold funnel

## What happened

Marcus uses the hold funnel to decide how long the hold window should be. The
report currently says we convert almost every hold into a sale, which does not
match anything else he can see: he watches the seat map all day and he knows
holds time out constantly.

He also noticed the total number of holds the report claims were created is
larger than the number of rows he can count in the holds table, and that the two
disagree more for the arena — where people buy several seats at once — than for
the club, where they mostly buy one.

## Example

For the arena:

| line | report says | Marcus's count |
|---|---|---|
| holds created | 20 | 13 |
| converted | 14 | 7 |
| expired | 0 | 3 |
| released | 0 | 1 |
| still active | 6 | 2 |
| conversion | 70% | 54% |

Marcus: "It is telling me nothing ever expires. I can watch seats come back into
the map while the report says that never happens."

## Steps to reproduce

1. Seed the analytics dataset and produce the hold funnel answer.
2. Compare `holds_created` against the number of rows in `holds` for that event.
3. Compare the expired and released counts against the holds whose status is
   `expired` and `released`.

Expected: the funnel accounts for every hold exactly once, and the four outcome
counts add up to the number created.
Actual: holds covering several seats are counted more than once, and holds that
expired or were released are missing almost entirely — which is what pushes the
conversion rate up.

## Notes

A hold can cover any number of seats. Whatever the funnel counts, it has to be
one row per hold, and it has to still see holds that are no longer live — Marcus
specifically wants the ones that did *not* convert.

## Definition of done

- Every hold is counted exactly once, regardless of how many seats it covers.
- Expired and released holds appear.
- The outcome counts sum to the number of holds created.
