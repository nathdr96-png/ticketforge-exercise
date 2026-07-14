# Difficulty tiers and time budgets

Candidates progress as far as they can. A clean Tier 2 beats a broken Tier 3.

| Tier | Task | Separates |
|---|---|---|
| **T1** | CRUD events + seats, list with pagination, auth | Can they ship at all |
| **T2** | Hold a seat, no double-booking under parallel load | Juniors from mids |
| **T3** | Idempotent purchase, expiring holds, correct money math | Mids from seniors |
| **T4** | Meet the perf budget; explain your query plan | Seniors from staff |

## Objective gates

- **T2 concurrency:** 200 VUs → exactly 1 winner on the same seat (`conformance/concurrency/hold_same_seat.js`)
- **T3 money:** `fee_cents = floor(subtotal_after_discount * 5 / 100) + 30` (unless a variant overrides it)
- **T4:** p95 `< 150ms` on `GET /events/{id}/seats` for the 2000-seat event; index scan, not a sequential scan; web bundle `< 250KB` gzipped when grading web slots

Scenarios: `contract/scenarios/T1-*.md` … `T4-*.md`.

---

## Time budgets — from-scratch mode

Total time-box **2 hours**. Tell the candidate these numbers up front; pacing is
part of what we are assessing, and candidates who are not told the budget tend to
over-invest in T1.

| Tier | Target spend | Cumulative | If they are over |
|---|---|---|---|
| T1 | 35 min | 0:35 | They are gold-plating. Nudge once. |
| T2 | 40 min | 1:15 | Expected for juniors — T2 is the real wall. |
| T3 | 35 min | 1:50 | Fine. Most candidates stop here. |
| T4 | remainder | 2:00 | Only reached by strong seniors. |

Nobody is expected to finish T4. Reaching T3 cleanly inside two hours is a good
senior result.

## Time budgets — real-project mode

Total time-box **2 hours** for one bug plus one feature, which is what `join.sh`
assigns by default. Roughly 20 minutes of that goes on reading code they have
never seen, and that reading time is a signal, not waste.

| Phase | Target spend |
|---|---|
| Orientation: run it, run the tests, find the relevant code | 20 min |
| Bug: reproduce, diagnose, fix, add a regression test | 40 min |
| Feature: implement to the acceptance criteria, with tests | 50 min |
| Tidy: commit history, PR description, note what is unfinished | 10 min |

Individual tickets are estimated at anywhere from 20 to 70 minutes. When more
than one bug is assigned alongside the feature, the budget is raised to 2.5 hours
or one ticket is expected to be left unfinished — whoever briefs you will say
which.

An honest "here is what I would do next and why" beats a rushed half-fix. Say so
when you brief them, and mean it when you grade.
