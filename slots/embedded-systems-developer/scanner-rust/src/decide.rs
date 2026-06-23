//! The admission decision, in one function, in the declared precedence order.
//!
//! Kept apart from the transcript loop and from the state files on purpose: this
//! is the part a reviewer reads to check it against
//! `contract/scanner/interface.yaml`, and the part the unit tests call directly
//! without touching a disk.

use crate::state::{Reason, State};
use crate::ticket::{parse_blob, Ticket};

/// Decide one SCAN. Reads the state (the gate, the admitted set, the trusted
/// clock) and changes none of it — the caller records the outcome.
///
/// `None` for the ticket means the blob never parsed, the decision is
/// `Malformed`, and the caller must print `-` rather than anything else.
pub fn decide(st: &State, blob: &str) -> (Reason, Option<Ticket>) {
    // The precedence below is declared in contract/scanner/interface.yaml and
    // two steps of it are decisions rather than conveniences:
    //
    //   MALFORMED first, so nothing else about a blob is looked at until it
    //   has parsed. These bytes come off a barcode held by a member of the
    //   public.
    //
    //   DUPLICATE before any of the time checks, so that a ticket which has
    //   already been through this turnstile reads DUPLICATE whatever the clock
    //   says. "Already used" does not depend on the time, and it is the answer
    //   the person on the door can act on.

    let Some(ticket) = parse_blob(blob) else {
        return (Reason::Malformed, None);
    };

    // TODO(FEAT-1112): the ticket's fields are not authenticated yet, so a
    // reprinted barcode with an edited window is accepted.
    if st.gate_event_id.is_empty() {
        return (Reason::NotCommissioned, Some(ticket));
    }
    if ticket.event_id != st.gate_event_id {
        return (Reason::WrongEvent, Some(ticket));
    }
    if st.admitted_contains(&ticket.ticket_id) {
        return (Reason::Duplicate, Some(ticket));
    }

    // Validity is decided against the ticket's own signed window and the
    // device's TRUSTED clock — the last authoritative time from upstream
    // carried forward by monotonic elapsed time. st.wall is never read here,
    // and that is rule SCAN-R09: coin cells die, and the local clock is the one
    // input somebody standing at this door can influence.
    let now = st.trusted_now();
    if now < 0 {
        return (Reason::NoTrustedTime, Some(ticket));
    }
    if now < ticket.valid_from {
        return (Reason::NotYetValid, Some(ticket));
    }
    if now > ticket.valid_to {
        return (Reason::Expired, Some(ticket));
    }
    (Reason::Ok, Some(ticket))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARENA_FROM: i64 = 1_788_282_000;
    const ARENA_TO: i64 = 1_788_300_000;
    const AT_DOOR: i64 = 1_788_285_600;

    fn signed(tid: &str, eid: &str, sid: &str, from: i64, to: i64) -> String {
        // TODO(FEAT-1112): tickets cannot be signed yet, so these blobs carry a
        // placeholder signature that only has the right shape.
        format!("{tid}|{eid}|{sid}|{from}|{to}|0000000000000000")
    }

    fn arena(seat: u32) -> String {
        signed(
            &format!("tkt_arena_A01-{seat:02}"),
            "event_arena_2000",
            &format!("seat_arena_A01-{seat:02}"),
            ARENA_FROM,
            ARENA_TO,
        )
    }

    fn fresh(name: &str) -> (State, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("tf-rust-dec-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let st = State::open(&dir, 64).expect("opens");
        (st, dir)
    }

    fn commission(st: &mut State) {
        st.commission("event_arena_2000");
        st.link_up = true;
        st.trusted_epoch = Some(AT_DOOR);
        st.trusted_anchor_mono = 0;
        st.mono = 0;
        st.wall = AT_DOOR;
    }

    #[test]
    fn the_precedence_is_the_declared_one() {
        let (mut st, dir) = fresh("prec");

        assert_eq!(decide(&st, &arena(1)).0, Reason::NotCommissioned);
        commission(&mut st);
        assert_eq!(decide(&st, &arena(1)).0, Reason::Ok);

        // Malformed wins over a bad signature: the length check comes first.
        let long_id = format!("tkt_{}", "X".repeat(196));
        let over = signed(&long_id, "e", "s", ARENA_FROM, ARENA_TO);
        let (reason, ticket) = decide(&st, &over);
        assert_eq!(reason, Reason::Malformed);
        assert!(ticket.is_none(), "an unparsed blob reports no ticket id");

        let jazz = signed(
            "tkt_jazz_A01-01",
            "event_jazz_eur",
            "seat_jazz_A01-01",
            ARENA_FROM,
            ARENA_TO,
        );
        assert_eq!(decide(&st, &jazz).0, Reason::WrongEvent);

        // DUPLICATE wins over EXPIRED: "already used" does not depend on the clock.
        assert!(st.admitted_insert("tkt_arena_A01-01", AT_DOOR, false));
        st.mono += 100_000; // long past valid_to
        assert_eq!(decide(&st, &arena(1)).0, Reason::Duplicate);
        assert_eq!(decide(&st, &arena(2)).0, Reason::Expired);

        st.mono = 0;
        st.trusted_epoch = Some(ARENA_FROM - 100);
        assert_eq!(decide(&st, &arena(2)).0, Reason::NotYetValid);
        st.trusted_epoch = None;
        assert_eq!(decide(&st, &arena(2)).0, Reason::NoTrustedTime);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_wall_clock_never_decides_an_admission() {
        let (mut st, dir) = fresh("clock");
        commission(&mut st);
        for wall in [0, 1_893_456_000, i64::from(u32::MAX)] {
            st.wall = wall;
            assert_eq!(
                decide(&st, &arena(3)).0,
                Reason::Ok,
                "wall clock {wall} must not change the answer"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
