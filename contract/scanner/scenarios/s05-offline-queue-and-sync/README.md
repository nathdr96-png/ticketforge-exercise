# s05-offline-queue-and-sync

The reason the device exists. The network at a venue door is unreliable, so the
door keeps working and the records wait. When the link comes back they go up in
the order they were taken, each exactly once, and the queue empties.

`uploaded.log` is the artifact that proves it: thirteen records, record ids
ascending with no gaps and no repeats. A device that re-sends on every sync, or
that drains the queue before the upload is acknowledged, shows up there.
