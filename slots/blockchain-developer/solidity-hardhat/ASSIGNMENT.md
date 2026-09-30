# Your assignment

Welcome. You are working in `slots/blockchain-developer/solidity-hardhat`.

This is a running codebase, not a blank page. Nobody expects you to have
written it. What we want to see is how you work inside code you did not
write: how you reproduce a problem, how you find its cause, and how small
and safe you can make the change that fixes it.

## Setup

```
cd slots/blockchain-developer/solidity-hardhat
make install
make run                      # deploys locally, writes ./deployment/deployment.json
```

Then, from the repository root, run the suite to see where you are starting:

```
cd conformance/blockchain && npm install
CHAIN_DEPLOYMENT=../../slots/blockchain-developer/solidity-hardhat/deployment/deployment.json npx vitest run
```

There is nothing to boot and nothing to connect to. `make run` compiles
your contracts, deploys them to an in-process development chain, writes
`deployment/deployment.json` and exits. That file records every
transaction your deployer sent, in order; the suite starts a chain of
its own, replays them, and drives the contracts that come out. It
imports nothing from your slot, so the file is your whole interface
with it — and it checks that replaying your steps reproduces your
declared addresses exactly.

Nothing here touches the network: no testnet, no RPC endpoint, no
faucet, no fork, and no private key from the environment. The role
accounts are the standard local mnemonic's, by index. A slot that needs
a key is misconfigured, not secure, and the suite fails it.

Read `contract/onchain/` first. It is to this role what
`contract/openapi.yaml` is to the backend: every rule you are graded
on is in `rules.yaml` with the reason a reviewer would care — including
the stated limitation on the resale cap, which is a real edge rather
than an oversight. Seats, events, prices and discount codes all come
from `contract/seed/`, and the fee is the product's one published fee.

Three of the suite's tests are property runs rather than examples: they
generate sequences of calls and check the invariants after every step,
with a pinned seed. Most of the interesting mistakes in this work are
only reachable through an ordering, so `make test` passing is not
evidence of much on its own.

Some of those tests fail right now. That is expected — see your tickets.
Do not assume the failing tests are the whole story: a green suite is not
proof a ticket is fixed. Reproduce what the reporter described.

## Tickets assigned to you

- **Bug** — `issues/BUG-902-settlement-will-not-reconcile.md`
- **Feature** — `issues/FEAT-907-resale-price-cap.md`

Read the ticket, not just the failing test. The ticket is what the
reporter actually experienced.

## How we review this

- Does the bug actually stop happening, and did you fix the cause rather
  than suppress the symptom?
- Did anything else break? The whole suite must still pass.
- Is the change proportionate? We look at the size and shape of the diff.
- Did you add a test that would have caught this?
- Does the code look like it belongs in this codebase?
- Your commit history. Commit as you work; see CONTRIBUTING.md.

## Ground rules

- Do not edit `contract/` or `conformance/`. Add your own tests beside
  the code you change.
- Time-box: see `docs/TIERS.md`. Stop when the time is up and write down
  what you would do next — an honest note beats a rushed half-fix.
- AI assistance is allowed. Note where you used it in the message you
  send with your fork's URL. We will ask you to change something live in
  the debrief.

Provisioned 2026-10-10.
