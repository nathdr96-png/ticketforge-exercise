{{ config(materialized='view') }}

-- Ordering is NOT in this model. A dbt relation is a table or a view and
-- has no inherent row order; the contract's ORDER BY is applied when the
-- relation is exported, by tools/export.py reading it from
-- contract/analytics/questions.yaml, which orders this one by:
--   ORDER BY d.code ASC, r.currency ASC NULLS LAST

-- q6_discount_effectiveness — Discount code effectiveness
--
-- Contract: contract/analytics/questions.yaml, question q6_discount_effectiveness.
--
-- Driven FROM `discounts`, outer-joined to the orders. Marketing's actual
-- question is "which codes is nobody using", and a query that starts from
-- `orders` cannot answer it: the unused codes are precisely the rows that are
-- missing.
--
-- The grain is (code, currency), not code. SAVE10 is global and has been
-- redeemed on both a USD and a EUR event; one row per code would mean adding
-- euros to dollars. A code with no paid orders gets exactly one row, currency
-- NULL, everything zero.

-- TODO(FEAT-26): discount effectiveness is not implemented yet.
-- The shape below is a placeholder so that the model still builds and `make run`
-- still produces a result file. See the ticket for what this model has to
-- answer. Note that the orders side is not joined at all yet, so the source()
-- call that brings the redemptions in has to be added back.
SELECT d.code                 AS code,
       d.percent_off          AS percent_off,
       d.active               AS active,
       NULL::char(3)          AS currency,
       0::bigint              AS orders_count,
       0::bigint              AS gross_cents,
       0::bigint              AS discounts_cents,
       0::bigint              AS fees_cents,
       0::bigint              AS net_cents
FROM {{ source('ticketforge', 'discounts') }} d
