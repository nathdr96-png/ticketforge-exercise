# Contributing

- Branch from `main`. One branch per ticket.
- Commit as you go. Small, reviewable commits with a short imperative subject.
  We read the history during review — a single squashed dump tells us nothing.
- `contract/` is the source of truth and is owned by the platform team. If you
  believe the contract is wrong, say so in your write-up; do not edit it.
- Never edit `conformance/`. Those tests are how every stack is compared. Add
  your own tests next to the code you change instead.
- Run `make test` before you push.
