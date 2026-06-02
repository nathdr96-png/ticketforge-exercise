#!/usr/bin/env bash
# Run every declared scanner scenario against one device binary and write the
# declared outputs. This is part of the CONTRACT, not of any slot: the C, Rust
# and MicroPython scanners are driven by this identical script, so a difference
# between them is a difference in the device and never a difference in how it
# was exercised.
#
#   SCANNER_BIN=./build/scanner SCAN_OUT_DIR=./out contract/scanner/run-scenarios.sh
#
# Both variables are required. SCAN_OUT_DIR has no default on purpose: writing a
# device's state into a directory nobody meant is how a grading run ends up
# reading somebody else's results.
#
# The output layout, which conformance/edge grades:
#
#   $SCAN_OUT_DIR/manifest.tsv            the scenarios that were actually run
#   $SCAN_OUT_DIR/<id>/decisions.txt      every segment's stdout, concatenated in order
#   $SCAN_OUT_DIR/<id>/stderr.log         every segment's stderr, concatenated in order
#   $SCAN_OUT_DIR/<id>/exit-codes.txt     "<segment> <exit status>" per segment
#   $SCAN_OUT_DIR/<id>/state/             the live state directory at the end of the run
#   $SCAN_OUT_DIR/<id>/after-NN/          a snapshot of state/ after each segment
#
# A segment boundary is a RESTART: the device process exits and a new one is
# started against the same state directory. That is the only way to measure
# whether anything was actually persisted.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCEN_DIR="${SCAN_SCENARIOS_DIR:-$HERE/scenarios}"

if [[ -z "${SCANNER_BIN:-}" ]]; then
  echo "SCANNER_BIN is not set — nothing to run" >&2
  exit 2
fi
if [[ -z "${SCAN_OUT_DIR:-}" ]]; then
  echo "SCAN_OUT_DIR is not set — refusing to guess where to write device state" >&2
  exit 2
fi
if [[ ! -x "$SCANNER_BIN" ]]; then
  echo "SCANNER_BIN is not executable: $SCANNER_BIN (did you run \`make build\`?)" >&2
  exit 2
fi
if [[ ! -f "$SCEN_DIR/index.tsv" ]]; then
  echo "no scenario manifest at $SCEN_DIR/index.tsv" >&2
  exit 2
fi

BIN="$(cd "$(dirname "$SCANNER_BIN")" && pwd)/$(basename "$SCANNER_BIN")"
# This script runs without `set -e`, so every step before the delete below has
# to be checked by hand. It previously was not: if SCAN_OUT_DIR named a regular
# file, `cd` failed, OUT came back EMPTY, the guard compared "" with "/" and let
# it through, and `rm -rf "$OUT"/*` became `rm -rf /*`.
if ! mkdir -p "$SCAN_OUT_DIR"; then
  echo "cannot create SCAN_OUT_DIR=$SCAN_OUT_DIR" >&2
  exit 2
fi
if ! OUT="$(cd "$SCAN_OUT_DIR" && pwd)" || [[ -z "$OUT" || ! -d "$OUT" ]]; then
  echo "SCAN_OUT_DIR=$SCAN_OUT_DIR is not a usable directory — refusing to clear anything" >&2
  exit 2
fi
# The next line deletes everything in there: a SCAN_OUT_DIR that resolved to the
# root, the home directory or the repository itself is a typo, not an instruction.
if [[ "$OUT" == "/" || "$OUT" == "${HOME:-/nonexistent}" || -d "$OUT/.git" || -d "$OUT/contract" ]]; then
  echo "refusing to clear $OUT — SCAN_OUT_DIR should be a directory of its own" >&2
  exit 2
fi
# ${OUT:?} makes bash itself refuse an empty OUT, as a last line of defence.
rm -rf "${OUT:?}"/*
cp "$SCEN_DIR/index.tsv" "$OUT/manifest.tsv"

# What the device under test actually is. Rule SCAN-R14 grades memory safety as
# "every segment exits 0 with an empty stderr", and that measurement is only
# worth anything if the binary was built with something watching — otherwise a
# device with a buffer overflow in it passes by being quiet about it. So the
# mechanism is DETECTED here rather than declared by the slot, and
# conformance/edge asserts the finding.
#
#   asan / ubsan  the sanitizer runtimes are linked in (a C or C++ device)
#   rust          the Rust panic machinery is linked in, so bounds and overflow
#                 checks are in the language and cannot be dropped from a build
mechanisms=""
probe() {
  if grep -a -q -- "$2" "$BIN" 2>/dev/null; then
    mechanisms="${mechanisms:+$mechanisms,}$1"
  fi
}
probe asan __asan_init
probe ubsan __ubsan_handle
probe rust rust_begin_unwind
{
  echo "binary $BIN"
  echo "bytes $(wc -c < "$BIN" | tr -d ' ')"
  echo "memory_safety ${mechanisms:-none}"
} > "$OUT/device.txt"

ran=0
while IFS=$'\t' read -r sid qmax nseg seeded _title; do
  [[ -z "$sid" || "$sid" == \#* ]] && continue
  src="$SCEN_DIR/$sid"
  dst="$OUT/$sid"
  state="$dst/state"
  mkdir -p "$state"
  if [[ "$seeded" == "yes" ]]; then
    # A device that has already been in service: its counters, its admitted set
    # and its queue come off the flash it was handed to us with.
    cp -a "$src/initial-state/." "$state/"
  fi
  : > "$dst/decisions.txt"
  : > "$dst/stderr.log"
  : > "$dst/exit-codes.txt"

  for ((i = 1; i <= nseg; i++)); do
    seg="$(printf '%02d' "$i")"
    "$BIN" --state "$state" --queue-max "$qmax" \
      < "$src/$seg.txt" >> "$dst/decisions.txt" 2>> "$dst/stderr.log"
    echo "$seg $?" >> "$dst/exit-codes.txt"
    rm -rf "$dst/after-$seg"
    mkdir -p "$dst/after-$seg"
    cp -a "$state/." "$dst/after-$seg/" 2>/dev/null || true
  done
  ran=$((ran + 1))
  echo "  $sid: $nseg segment(s), queue_max=$qmax"
done < "$OUT/manifest.tsv"

echo "ran $ran scenario(s) into $OUT"
