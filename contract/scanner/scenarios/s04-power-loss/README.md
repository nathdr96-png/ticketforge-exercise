# s04-power-loss

The difference between this and `s03-restart-remembers` is the whole point of
the scenario. There the device reaches end of input and exits normally, so a
buffered implementation gets away with flushing on the way out. Here `ABORT`
terminates the process immediately — no stdio flush, no atexit handler, no
destructor — which is what losing the mains at a turnstile actually looks like.

So every decision has to be durable *before* it is announced. A device that
batches its writes passes s03 and fails here, which is precisely the bug worth
catching: it is invisible until the one night it matters.
