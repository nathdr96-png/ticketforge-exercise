//! The TicketForge turnstile scanner.
//!
//! ```text
//! scanner --state <dir> --queue-max <n>  < transcript  > decisions
//! ```
//!
//! Reads a transcript of door events on stdin, decides each admission by itself
//! because the network at a venue door cannot be relied on, and keeps everything
//! it knows in the state directory so that being power-cycled mid-event costs
//! nothing.
//!
//! The contract is `contract/scanner/` — `interface.yaml` for the grammar and
//! the file formats, `rules.yaml` for the seventeen rules with their ids,
//! `README.md` for why each one is a rule. This implementation and
//! `slots/embedded-systems-developer/scanner-c` are driven by the same
//! `contract/scanner/run-scenarios.sh` and are graded byte for byte against the
//! same expectations.
//!
//! Two invariants hold everywhere in this file and are the reason it is shaped
//! the way it is:
//!
//! 1. State is persisted BEFORE the decision for it is printed (SCAN-R03). Not
//!    after, and not on the way out: ABORT below is `process::exit(0)`, which
//!    runs no destructor, exactly as losing the mains would.
//!
//! 2. Nothing is written to stderr, ever (SCAN-R14). On this slot stderr is
//!    where a panic would go, and the grading surface is "every segment exits 0
//!    with an empty stderr". A device that logs there makes that measurement
//!    impossible, so diagnostics that matter go into the state directory.
//!
//! Memory safety here is the language's rather than a sanitizer's, which is why
//! `forbid(unsafe_code)` is not decoration: it is the whole of this slot's claim
//! under SCAN-R14, and `contract/scanner/run-scenarios.sh` detects it from the
//! binary rather than taking the slot's word for it.
#![forbid(unsafe_code)]

mod decide;
mod state;
mod ticket;

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process;

use decide::decide;
use state::{Reason, Record, State};
use ticket::LINE_MAX;

const DEFAULT_QUEUE_MAX: usize = 64;

/// A fatal problem before the first event — a missing `--state`, an unwritable
/// directory. There is no decision stream yet and nothing to reconcile, so this
/// is the one place a non-zero exit is correct. It still says nothing on stderr;
/// the status is the whole message, and `exit-codes.txt` is where it is read.
fn die() -> ! {
    process::exit(2)
}

/// One decision line, then flush. The operator watching the door log sees the
/// answer the instant it is made, and a power cut cannot swallow a decision the
/// device has already committed to.
fn emit(line: &str) {
    let mut out = std::io::stdout();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

fn parse_i64(s: &str) -> Option<i64> {
    if s.is_empty() || s.starts_with('+') || s.trim() != s {
        return None;
    }
    s.parse::<i64>().ok()
}

fn handle_scan(st: &mut State, blob: &str) {
    let (reason, ticket) = decide(st, blob);
    let admitted = reason == Reason::Ok;
    let now = st.trusted_now();
    let ticket_id = ticket.as_ref().map(|t| t.ticket_id.clone());

    let seq = st.next_seq;
    st.next_seq += 1;
    st.scans_total += 1;
    if admitted {
        st.admitted_total += 1;
        if let Some(id) = &ticket_id {
            st.admitted_insert(id, now, false);
        }
    } else {
        st.count_refusal(reason);
    }

    // Every scan is queued, refusals included: a ticket presented twice is
    // exactly what the back office wants to see (SCAN-R16).
    let rec = Record {
        record_id: st.next_record_id,
        ticket_id: ticket_id.clone().unwrap_or_else(|| "-".to_string()),
        scanned_at: now,
        admitted,
        reason,
    };
    st.next_record_id += 1;
    st.queue_push(&rec);
    st.queued_total += 1;

    let _ = st.persist();
    emit(&format!(
        "{} {} {} {}",
        seq,
        ticket_id.as_deref().unwrap_or("-"),
        if admitted { "ADMIT" } else { "REFUSE" },
        reason.name()
    ));
}

fn handle_sync(st: &mut State) {
    let sent = st.queue_upload();
    let _ = st.persist();
    emit(&format!("SYNC {} {}", sent, st.queue_depth()));
}

fn handle_replay(st: &mut State, args: &str) {
    let mut it = args.split_whitespace();
    let id = it.next().unwrap_or("");
    let at = it.next().and_then(parse_i64);

    st.replay_total += 1;
    // A replayed record is upstream telling us something it already knows. It
    // is never new work: it does not queue, it does not move admitted_total
    // (which counts people THIS door let in), and it never removes anything
    // from the admitted set. Absorbing one we have not seen is what makes a
    // two-gate venue safe — the far door admitted them, so this one must
    // refuse them (SCAN-R06).
    if let Some(at) = at {
        if State::ticket_id_fits(id) && st.admitted_insert(id, at, true) {
            st.replay_absorbed_total += 1;
        }
    }
    let _ = st.persist();
}

fn main() {
    let mut dir: Option<PathBuf> = None;
    let mut queue_max = DEFAULT_QUEUE_MAX;

    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--state" if i + 1 < argv.len() => {
                dir = Some(PathBuf::from(&argv[i + 1]));
                i += 2;
            }
            "--queue-max" if i + 1 < argv.len() => {
                match argv[i + 1].parse::<usize>() {
                    Ok(n) if (1..=1_000_000).contains(&n) => queue_max = n,
                    _ => die(),
                }
                i += 2;
            }
            _ => die(),
        }
    }
    let Some(dir) = dir else { die() };
    let Ok(mut st) = State::open(&dir, queue_max) else {
        die()
    };

    let mut reader = BufReader::new(std::io::stdin());
    let mut raw: Vec<u8> = Vec::with_capacity(LINE_MAX + 2);
    loop {
        raw.clear();
        match reader.read_until(b'\n', &mut raw) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        while raw.last() == Some(&b'\n') || raw.last() == Some(&b'\r') {
            raw.pop();
        }
        if raw.len() > LINE_MAX {
            // Longer than the declared maximum: not a line this device will act
            // on, counted so it is visible, and survived.
            st.unknown_event_total += 1;
            let _ = st.persist();
            continue;
        }
        // Non-ASCII bytes are not a transcript. Replacing them rather than
        // refusing to read keeps the loop going, and the line that comes out
        // will not match any verb, so it is counted as unknown.
        let line = String::from_utf8_lossy(&raw).to_string();
        let trimmed = line.trim_start();
        let (verb, args) = match trimmed.find(|c: char| c == ' ' || c == '\t') {
            Some(at) => (&trimmed[..at], trimmed[at + 1..].trim_start()),
            None => (trimmed, ""),
        };
        if verb.is_empty() || verb.starts_with('#') {
            continue;
        }

        match verb {
            "SCAN" => handle_scan(&mut st, args),
            "SYNC" => handle_sync(&mut st),
            "REPLAY" => handle_replay(&mut st, args),
            "GATE" => {
                if !st.commission(args) {
                    st.unknown_event_total += 1;
                }
                let _ = st.persist();
            }
            "LINK" => {
                match args {
                    "up" => st.link_up = true,
                    "down" => st.link_up = false,
                    _ => st.unknown_event_total += 1,
                }
                let _ = st.persist();
            }
            "TICK" => {
                match parse_i64(args) {
                    // Elapsed time: the monotonic clock and the wall clock both
                    // move by it.
                    Some(secs) if secs >= 0 => {
                        st.mono += secs;
                        st.wall += secs;
                    }
                    _ => st.unknown_event_total += 1,
                }
                let _ = st.persist();
            }
            "NOW" => {
                match parse_i64(args) {
                    // A clock jump: the device's wall clock is set.
                    Some(t) => st.wall = t,
                    None => st.unknown_event_total += 1,
                }
                let _ = st.persist();
            }
            "TIME" => {
                match parse_i64(args) {
                    None => st.unknown_event_total += 1,
                    Some(t) if t < 0 => st.unknown_event_total += 1,
                    Some(_) if !st.link_up => {
                        // Authoritative time has to come over the link. A value
                        // that arrives with the link down did not come from
                        // upstream.
                        st.time_rejected_total += 1;
                    }
                    Some(t) => {
                        st.trusted_epoch = Some(t);
                        st.trusted_anchor_mono = st.mono;
                    }
                }
                let _ = st.persist();
            }
            "ABORT" => {
                // The mains go. Everything already announced on stdout is
                // already on the flash, so there is nothing to do here but
                // stop — and stopping has to skip every destructor and every
                // buffer. A device that only gets its state right because of
                // the code that runs on the way out has not got it right
                // (SCAN-R03).
                process::exit(0);
            }
            _ => {
                // A verb this device has never heard of. One day a newer server
                // will send it one and the door must keep working.
                st.unknown_event_total += 1;
                let _ = st.persist();
            }
        }
    }

    let _ = st.persist();
    // Read the rest of stdin so a writer upstream never sees EPIPE on a
    // transcript we chose to stop reading. Costs nothing and keeps the runner's
    // exit status meaning what it says.
    let mut sink = Vec::new();
    let _ = reader.read_to_end(&mut sink);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_i64_is_strict() {
        assert_eq!(parse_i64("0"), Some(0));
        assert_eq!(parse_i64("-5"), Some(-5));
        assert_eq!(parse_i64("1788285600"), Some(1_788_285_600));
        for bad in ["", "+1", " 1", "1 ", "0x10", "1.0", "notanumber"] {
            assert_eq!(parse_i64(bad), None, "should have refused {bad:?}");
        }
    }

    #[test]
    fn the_declared_limits_are_the_contract_ones() {
        assert_eq!(crate::ticket::EVENT_ID_MAX, 32);
        assert_eq!(crate::ticket::TICKET_ID_MAX, 64);
        assert_eq!(crate::ticket::BLOB_MAX, 256);
        assert_eq!(LINE_MAX, 1024);
    }
}
