# s03-restart-remembers

A scanner at a door gets power-cycled, re-flashed and rebooted mid-event. The
second segment is a fresh process with an empty memory and the same state
directory, and it must pick up exactly where the first left off — including the
sequence counter, the queue, the link state and the trusted-time anchor.

Note that nothing in segment 2 re-commissions the gate or re-fetches the time.
A device that keeps commissioning in RAM admits a ticket for the wrong event
after every reboot.
