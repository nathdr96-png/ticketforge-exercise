# Tier 2 — Seat holds, no double-booking

## T2-01 Create hold
Given authenticated buyer `buyer01` and an available seat on `event_arena_2000`
When they `POST /holds` with that `event_id` and `seat_ids`
Then the response is 201
And hold `status` = `active`
And `expires_at` is ~600 seconds after `created_at` (default TTL)
And the seat now reports `status` = `held`

## T2-02 Concurrent hold — single winner
Given one available seat
When 200 concurrent buyers attempt to hold that same seat
Then exactly one request returns 201
And all others return 409 with `SEAT_ALREADY_HELD` or `SEAT_NOT_AVAILABLE`
And the seat is held by exactly one buyer

## T2-03 Hold blocks second buyer
Given buyer01 holds seat X
When buyer02 attempts to hold seat X
Then the response is 409 with `SEAT_ALREADY_HELD`

## T2-04 Release hold
Given buyer01 has an active hold
When they `DELETE /holds/{id}`
Then the response is 204
And the seats return to `available`
And a subsequent hold by buyer02 succeeds

## T2-05 Buyer cannot release another's hold
Given buyer01 has an active hold
When buyer02 `DELETE /holds/{id}`
Then the response is 403 with `INSUFFICIENT_PERMISSION`
