# Choose your stack

This one repository holds the exercise for every role we hire for. Pick the
**one** directory that matches the role you applied for and ignore the rest.

1. Fork this repository on GitHub (keep your fork **private**).
2. Find your role in the table below.
3. Read `slots/<your-stack>/ASSIGNMENT.md`. It names your work and tells you
   exactly how to run things for that stack.
4. Read your ticket(s) in `issues/`.
5. Work on a branch in your fork and commit as you go. When you are done, push
   your branch (and its tags) to **your own private fork** and send us the fork's
   URL.

**Do not open a pull request against this repository.** Everyone who has
access to it can read its pull requests — including the other candidates.

If you are not sure which row is yours, ask us. It is not a trick question.

## The stacks

| Role | Work in | What the exercise is | Install before you start |
|---|---|---|---|
| Analytics / data engineer | `slots/data-engineer/dbt/` | Answer a fixed set of business questions over the ticketing database. Graded by comparing your result sets, not by reading your SQL. | PostgreSQL 16, Python 3.12 (dbt installs into a slot-local venv) |
| Analytics / data engineer | `slots/data-engineer/sql-analytics/` | Answer a fixed set of business questions over the ticketing database. Graded by comparing your result sets, not by reading your SQL. | PostgreSQL 16, `psql`, Python 3.12 |
| Application-security engineer | `slots/security-engineer/go/` | The same REST API, read as an attacker would: authorisation, token handling, what the error path leaks. | PostgreSQL 16, Go 1.26+ |
| Application-security engineer | `slots/security-engineer/java-spring/` | The same REST API, read as an attacker would: authorisation, token handling, what the error path leaks. | PostgreSQL 16, JDK 21 + Maven |
| Application-security engineer | `slots/security-engineer/node-ts/` | The same REST API, read as an attacker would: authorisation, token handling, what the error path leaks. | PostgreSQL 16, Node 20+ |
| Application-security engineer | `slots/security-engineer/python-fastapi/` | The same REST API, read as an attacker would: authorisation, token handling, what the error path leaks. | PostgreSQL 16, Python 3.12 |
| Backend engineer | `slots/backend-developer/go/` | A REST API over Postgres: events, seats, time-limited seat holds, orders. Fix the bug and build the feature. | PostgreSQL 16, Go 1.26+ |
| Backend engineer | `slots/backend-developer/java-spring/` | A REST API over Postgres: events, seats, time-limited seat holds, orders. Fix the bug and build the feature. | PostgreSQL 16, JDK 21 + Maven |
| Backend engineer | `slots/backend-developer/node-ts/` | A REST API over Postgres: events, seats, time-limited seat holds, orders. Fix the bug and build the feature. | PostgreSQL 16, Node 20+ |
| Backend engineer | `slots/backend-developer/python-fastapi/` | A REST API over Postgres: events, seats, time-limited seat holds, orders. Fix the bug and build the feature. | PostgreSQL 16, Python 3.12 |
| Embedded / systems engineer | `slots/embedded-systems-developer/scanner-c/` | A turnstile scanner. It reads a transcript of door events and writes its admit/refuse decisions and its state to files. Memory safety is graded, not linted. | gcc with AddressSanitizer + UBSan |
| Embedded / systems engineer | `slots/embedded-systems-developer/scanner-rust/` | A turnstile scanner. It reads a transcript of door events and writes its admit/refuse decisions and its state to files. Memory safety is graded, not linted. | Rust 1.83+ |
| Frontend engineer | `slots/frontend-developer/react-vite/` | The browser app for that API: seat map, hold countdown, checkout. We give you a running API to point it at. | Node 20+, **an API URL from us** |
| Frontend engineer | `slots/frontend-developer/vue/` | The browser app for that API: seat map, hold countdown, checkout. We give you a running API to point it at. | Node 20+, **an API URL from us** |
| ML / data-science engineer | `slots/ai-ml-engineer/fraud-scoring/` | An offline fraud-risk model. It trains on a committed dataset and writes predictions. The interesting mistakes here are methodological. | Python 3.12 |
| Mobile engineer | `slots/mobile-developer/react-native/` | The React Native app for the same API: seat map, hold countdown, checkout. We give you a running API to point it at. | Node 20+, **an API URL from us** |
| Platform / DevOps engineer | `slots/devops-cloud-engineer/k8s-helm/` | The deployment configuration for the product. Nothing is deployed and you need no cluster: you render the config and it is reviewed against a written policy. | `helm`, `kubeconform` |
| Platform / DevOps engineer | `slots/devops-cloud-engineer/terraform/` | The deployment configuration for the product. Nothing is deployed and you need no cluster: you render the config and it is reviewed against a written policy. | `terraform`, `kubeconform` |
| QA / test engineer | `slots/qa-engineer/playwright-suite/` | You own the TEST SUITE, not the application. The app is given and is believed correct. Three bugs reached customers without any test noticing. | Node 20+, **an API URL from us** |
| Smart-contract engineer | `slots/blockchain-developer/solidity-hardhat/` | An on-chain ticket sale. Deploys to a local development chain — no testnet, no funds, no key to set up. | Node 20+ |

Everything else in the repository is shared: `contract/` is the source of
truth for all of them, `conformance/` is the test suite that compares every
stack on the same bars, and `docs/` has the review criteria and the time
budget.

## Why the other stacks are here, and why reading them will not help

The other directories are other people's exercises. **They contain the same
bugs yours does, on purpose.** Stacks that implement the same thing — the four
backends, the three UI apps, the two analytics stacks, the two deployment
stacks, the two scanners — all carry an identical pair of planted problems.

So there is genuinely nothing to find by reading them. A working version of
your bug does not exist in this repository. We did it this way because the
alternative was 20 separate repositories to keep in step, and because
we would rather tell you plainly than rely on you not looking.

What you *may* find useful, and are welcome to: the shared `contract/` and the
visible `conformance/` tests. Those are the specification and they are the same
for everyone.

## Ground rules

- Do not edit `contract/` or `conformance/`. Add your own tests beside the code
  you change. If you think the contract is wrong, say so in your notes — that is
  a useful thing to tell us.
- Work only in your own stack's directory. A diff that touches somebody else's
  stack is noise we have to read.
- Time-box it: see `docs/TIERS.md`. When the time is up, stop and write down
  what you would do next. We mean that, and we grade accordingly.
- AI assistance is allowed. Note where you used it in the message you send with
  your fork's URL. In the debrief we will ask you to change something live, so
  work in a way you can explain.
- Please keep your fork private and do not publish your solution afterwards —
  we reuse these exercises.

Money is always integer minor units: no floating point anywhere near a price,
fee, discount or total. Timestamps are UTC, ISO-8601.
