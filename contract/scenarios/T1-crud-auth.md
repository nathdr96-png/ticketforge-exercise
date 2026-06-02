# Tier 1 — CRUD, pagination, auth

## T1-01 Login success
Given buyer `buyer01@ticketforge.test` with password `password123`
When they `POST /auth/login` with those credentials
Then the response is 200 with a non-empty `token` and `user.role` = `buyer`

## T1-02 Login failure
Given an unknown email
When they `POST /auth/login`
Then the response is 401 with error code `UNAUTHENTICATED`

## T1-03 Unauthenticated list
Given no Authorization header
When they `GET /events`
Then the response is 401 with error code `UNAUTHENTICATED`

## T1-04 List events paginated
Given an authenticated buyer
When they `GET /events?page=1&page_size=2`
Then the response is 200
And `data` has length ≤ 2
And `total` equals the number of events visible to buyers (published; draft/cancelled policy per SPEC — at minimum published events are listed)
And `page` = 1 and `page_size` = 2

## T1-05 Get event
Given authenticated buyer and event `event_arena_2000`
When they `GET /events/event_arena_2000`
Then the response is 200
And `seat_count` = 2000
And `base_price_cents` is an integer

## T1-06 List seats paginated + filter
Given authenticated buyer and event `event_arena_2000`
When they `GET /events/event_arena_2000/seats?section=A&availability=available&page=1&page_size=50`
Then the response is 200
And every seat in `data` has `section` = `A` and `status` = `available`
And `total` = 500 (25 rows × 20 seats in section A)
And money fields are integers

## T1-07 Health
When they `GET /health`
Then the response is 200 with `{"status":"ok"}`
