# FEAT-31 — Lock down traffic inside the ticketforge namespace

- **Requested by:** Priya (Site Reliability / on-call)
- **Type:** Feature
- **Affects:** deployment networking

## Context

Last month's penetration test produced one finding we have not closed. The tester
got a shell in a web pod — through a dependency, not through us — and from there
opened a connection straight to Postgres and read the orders table. The web app
is a static bundle: it has no database credential and no reason to reach the
database at all. Nothing stopped it because nothing in the namespace stops
anything.

The namespace currently has no traffic restrictions whatsoever. Every pod can
reach every other pod, and anything that gets a foothold anywhere gets the
database for free. Our auditors have asked for this by the end of the quarter
and I would like it before then.

## What we want

Traffic inside the namespace denied by default, with the paths the product
actually needs opened explicitly and nothing else.

## Acceptance criteria

1. Nothing in the namespace accepts incoming traffic unless a rule says it may.
   The baseline applies to every pod, including ones added later by someone who
   has not read this ticket.
2. The API and the web app accept traffic from the ingress controller, and from
   nothing else. In particular, not from each other and not from the sweeper.
3. The workloads that genuinely need the database — the API, the sweeper and the
   migration — may reach it. The web app may not.
4. DNS still resolves for the workloads that are allowed out, or none of the
   above works.
5. A single rule that selects every pod and permits all traffic does not count,
   even though it would appear in every listing as a network policy. Neither does
   disabling the whole thing with a flag.
6. `make run` still renders, `make test` still passes, and the chart still
   installs.

## Out of scope

- Service mesh, mTLS between workloads, egress to the public internet.
- Anything about the ingress controller's own namespace — that is the platform
  team's chart, not ours.
- Postgres' own `pg_hba` rules. Worth doing; different ticket.

## Definition of done

- The acceptance criteria above hold, evidenced by the rendered configuration.
- The rule the suite asserts is `DEP-019` in `contract/deploy/policy.yaml` — read
  it, and the reason given with it, before you start.
- Write down in your PR description what you deliberately did *not* allow, and
  how you would find out if one of these policies was blocking something real.
