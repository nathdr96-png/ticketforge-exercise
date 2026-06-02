# s10-bad-tickets

Everything a turnstile gets presented with that is not a ticket, in the order
the contract checks it. The precedence matters as much as the individual
answers: a 310-byte ticket id is `MALFORMED` and never reaches the signature
check, and a ticket for the jazz night is `WRONG_EVENT` at the arena door even
though it is perfectly valid at its own.

Three lines here exist to be hostile to the parser rather than to the rules, and
the first of them is the one that matters:

- a **200-byte ticket id inside a 243-byte blob**. The blob is under the declared
  256-byte maximum, so a parser that checks the blob's length and then copies the
  field without checking it reaches this line and writes 200 bytes into a 64-byte
  field. The suite runs the whole corpus under AddressSanitizer for this one
  line, and being refused is not enough: the process must also come out clean.
- a **310-byte ticket id inside a 370-byte blob**, which is over the blob maximum
  and is therefore refused before any field is looked at. It is here to make the
  precedence visible, not to stress the parser.
- a **900-byte line**, against a declared 1024-byte line maximum.

The last three lines matter too. An unknown event type is skipped, counted and
survived, because a newer server will one day send this device a verb it has
never heard of and the door must not stop. And after all of that, a real ticket
still gets in.
