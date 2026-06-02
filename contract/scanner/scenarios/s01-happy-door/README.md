# s01-happy-door

The baseline. Nothing is offline, nothing is wrong, nothing is skewed. It exists
so that a failure anywhere else in the corpus can be read as "that rule", not as
"the device does not work at all".

The last two `SYNC`s are the point: uploading an empty queue must upload nothing
rather than re-uploading what was already acknowledged.
