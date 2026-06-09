# conformance/blockchain

The black-box grader for the **blockchain / protocol** family. It reads
[`contract/onchain/`](../../contract/onchain/) and
[`contract/seed/`](../../contract/seed/), replays the deployment an
implementation declared, and asserts the rules in
[`rules.yaml`](../../contract/onchain/rules.yaml) over the live contracts.

```bash
cd conformance/blockchain && npm install

# deploy first — the slot writes the file this suite reads
cd ../../slots/blockchain-developer/solidity-hardhat && make install && make run

cd ../../../conformance/blockchain
CHAIN_DEPLOYMENT=../../slots/blockchain-developer/solidity-hardhat/deployment/deployment.json npx vitest run
```

`CHAIN_DEPLOYMENT` has **no default**. A default would silently grade a stale
file, or somebody else's chain, and both look exactly like a pass.

22 visible tests; some properties are also assessed at review.
A full run takes roughly a minute and a half, most of it the property runs.

## No network, no node, no key

The suite starts its **own** local development chain (`hardhat node`, on a port
the operating system picked) in `globalSetup.ts`, and kills it on the way out.
There is no RPC URL, no fork, no faucet, no testnet and no private key from the
environment anywhere in this directory, and the one contract the grader deploys
of its own — `attacker/ReentrantOrganizer.sol` — is **vendored as
compiled bytecode** so that not even a Solidity compiler download is needed.

Ports 8545 and 3000 are never used, not even as a fallback: on this
repository's development machines they are regularly occupied, and a grader
that quietly attached to somebody else's node would produce a confident grade
for the wrong contracts.

## How a deployment is graded without importing it

The slot is a batch job: `make run` boots a chain, deploys, writes one file and
exits — the same shape the data family uses. Its chain is gone by the time this suite starts. So the file it
leaves is not a convenience, it is the entire interface:

```json
{
  "schema": "ticketforge.onchain.deployment/1",
  "deployer": "0xf39F…",
  "contracts": { "PrimarySale": { "address": "0x5FbD…", "runtime_code_hash": "0x…", "abi": [] } },
  "steps": [
    { "index": 0, "kind": "deploy", "contract": "PrimarySale", "data": "0x60a0…", "address": "0x5FbD…" },
    { "index": 2, "kind": "call", "label": "PrimarySale.setTicketToken", "to": "0x5FbD…", "data": "0x…" }
  ]
}
```

`steps` is **every transaction the deployer sent, in order, as calldata**. The
suite replays it from nonce 0 onto its own chain and requires every declared
address to come back identical. That one assertion (ONC-001) is worth more than
it looks: a `CREATE` address is a pure function of (deployer, nonce), so
reproducing all of them proves the declared calldata is the *whole* truth about
how those contracts came to exist — no undeclared transaction in between, no
different bytecode, no setup step performed by hand.

Three consequences, all deliberate:

- **the grader never imports the slot.** No artifacts directory, no build
  config, no framework. A Foundry slot, a Vyper slot or a slot written in
  something nobody has invented yet is graded by this same file with no branch
  in it — the same principle that lets `conformance/data` grade SQL, dbt and
  pandas by comparing result files, and `conformance/infra` grade Helm and
  Terraform by reading rendered manifests.
- **calls are encoded against the contract, not the implementation.**
  [`contract/onchain/abi/`](../../contract/onchain/abi/) is the ABI every
  implementation must present. The slot's own declared ABI is *checked against*
  it rather than used in its place: otherwise a candidate could declare
  whatever interface they happened to write and the suite would faithfully
  grade it.
- **the grader holds the platform role.** It replayed the deployment, so it can
  register an event of its own. That is what makes it possible to test a sale
  window that has not opened yet (you cannot wind a chain backwards) and a
  withdrawal recipient that calls back.

## Files

| File | |
|---|---|
| `contract.ts` | the contract, loaded: rules, seed fixtures, the required ABI, and the declared deployment |
| `chain.ts` | the chain: replay, snapshots, the test clock, custom-error decoding |
| `globalSetup.ts` | starts and stops the one local chain for the whole run |
| `helpers.ts` | fixtures, the expected cost of a basket, and the grader's own event |
| `model.ts` | the generated call model, the batched state read, and the pinned-seed settings |
| `deployment.test.ts` | ONC-001 … ONC-003 |
| `primary.test.ts` | ONC-010 … ONC-023, ONC-040, ONC-041 |
| `resale.test.ts` | ONC-030, ONC-031 |
| `invariants.test.ts` | ONC-042 and the four invariants, over generated call sequences |
| `attacker/` | a contract recipient the suite can deploy to exercise withdrawals, source plus vendored bytecode |

`model.ts` is not a test file on purpose: it is the one shared definition of
"what a generated call sequence can do", so every check that drives the
contracts through generated sequences is grading the same contract.

## The property runs

Three of the 22 tests are property runs rather than examples, and they are
where the signal is for this role. Unit tests check named rules on named
inputs; on-chain code goes wrong on the fifth call in an order nobody wrote a
test for. So these four statements are asserted after **every step** of a
generated sequence of calls — buys, listings, resales, transfers and
withdrawals, by four wallets across two events:

| | |
|---|---|
| INV-1 (ONC-012) | minted never exceeds the event's registered seat count |
| INV-2 (ONC-042) | withdrawable balances never sum to more than the contract's balance |
| INV-3 (ONC-011) | no seat is ever two live tickets, and the sale's count agrees with the token's |
| INV-4 (ONC-021) | no wallet is ever over the per-event cap, in any ordering |

A revert is a legitimate outcome of a generated call and never a failure: the
point is that the invariant holds whether the call succeeded or not. What fails
the property is a call that *succeeds* and leaves the contract somewhere none
of the four statements allows.

The seed is pinned, so a pass is reproducible and a failure can be re-run until
it is understood — a fuzz run whose seed moves every time is a flaky test that
occasionally tells the truth. Both knobs are environment variables with
defaults in `vitest.config.ts`:

```bash
CHAIN_FUZZ_SEED=20260108 CHAIN_FUZZ_RUNS=200 npx vitest run invariants.test.ts
```

Raise `CHAIN_FUZZ_RUNS` to search harder. The default is tuned to keep a full
run to a minute or two.

## Regenerating the vendored attacker

Only needed if `attacker/ReentrantOrganizer.sol` changes:

```bash
cd conformance/blockchain && npm run attacker
```

It compiles the source with the pinned compiler settings and
rewrites `attacker/ReentrantOrganizer.json`. It is the only thing in this
directory that needs a Solidity compiler, it is never run during grading, and
the result is committed.
