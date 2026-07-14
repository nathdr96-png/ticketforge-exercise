# BUG-902 — Settlement will not reconcile: the contract has paid out more than one event earned

- **Reported by:** Dana (Finance)
- **Severity:** S1 — funds missing
- **Affects:** on-chain settlement

## What happened

I cannot close the month on the on-chain sales.

The Club Show and the Jazz Evening both sold. I added up what each event is owed
plus what we are owed in fees, and compared it with what the contract is
actually holding. The contract is short. Not by a rounding amount — by roughly
three times one event's whole payout.

Tracing it, one organiser's payout transaction moved money out of the contract
several times over in a single transaction. Their wallet is a shared treasury
contract rather than a plain wallet, if that matters. The other event's balance
still reads as owed, but the money to pay it is not there, so when Olivia asks
for her Club Show settlement I have nothing to give her.

I checked this against the revenue report and the report is fine. Every order,
every fee and every discount agrees with the API. The problem is only on the
settlement side.

## Steps to reproduce

Hard to do with an ordinary wallet, which is probably why nobody caught it:

1. On a local chain, let a buyer purchase seats for **two** different events, so
   both organisers are owed something.
2. Make one of the two organisers an address that *does something* when it
   receives money, rather than a plain wallet — a treasury contract, a splitter,
   a multisig.
3. Have that organiser withdraw their proceeds.
4. Add up what the contract still says it owes everybody, and compare it with
   the contract's actual balance.

Expected: the two numbers agree, and the organiser received exactly what they
were owed, once.
Actual: the organiser received several times what they were owed, and the
contract no longer holds enough to pay the other event.

## Notes

Both organisers were plain wallets when we tested this before launch. Omar moved
to a shared treasury contract last month because of how his venue splits
revenue, and I believe that is when this started — but his contract is not doing
anything unusual, it just forwards what it receives.

## Definition of done

- A withdrawal pays out exactly what is owed, once, whatever the recipient does
  when it is paid.
- At every moment, what the contract says it owes everybody is exactly what the
  contract is holding.
- Say in the PR what it is about your version that makes this impossible, and
  what somebody would have to believe about the recipient for the old version to
  have been safe.
