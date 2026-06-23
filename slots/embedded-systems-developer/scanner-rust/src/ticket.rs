//! Ticket blobs: the only thing an offline turnstile has to go on.
//!
//! The device holds no ticket database — it cannot, it is offline — so every
//! fact needed to decide an admission travels in the blob, and the signature is
//! what stops the blob being edited on the way.
//!
//! Format and limits are `contract/scanner/interface.yaml`; the reasoning is in
//! `contract/scanner/README.md`.

/// Declared maxima. A field longer than its maximum is MALFORMED (rule
/// SCAN-R13). These bytes arrive from a barcode held by a member of the public.
pub const TICKET_ID_MAX: usize = 64;
pub const EVENT_ID_MAX: usize = 32;
pub const SEAT_ID_MAX: usize = 32;
pub const BLOB_MAX: usize = 256;
pub const LINE_MAX: usize = 1024;
pub const SIG_HEX: usize = 16;

/// The exact integer bound every counter and every timestamp is declared to.
pub const EXACT_MAX: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Default)]
pub struct Ticket {
    pub ticket_id: String,
    pub event_id: String,
    // Parsed but not read anywhere yet: see the TODO(FEAT-1112) in decide.rs.
    #[allow(dead_code)]
    pub seat_id: String,
    pub valid_from: i64,
    pub valid_to: i64,
    pub signature: String,
}

/// Take one `|`-delimited field into a fixed-size buffer. The length is
/// MEASURED FIRST and the copy only happens if it fits: this is rule SCAN-R13,
/// and it is the whole reason the 200-byte ticket id in s10-bad-tickets is a
/// refusal and not a panic.
///
/// The buffer is fixed at the largest size the contract declares for any field,
/// rather than sized from whatever the barcode happened to contain, because
/// this runs on a device with 64 KiB of RAM and public input decides the
/// length. In this language an unchecked copy into it is a panic rather than a
/// silent overwrite — which is the point, but a panic at a turnstile is still a
/// closed door, so the check comes first either way.
fn take_field(field: &str, cap: usize) -> Option<String> {
    let len = field.len();
    if len == 0 || len > cap {
        return None;
    }
    let mut buf = [0u8; TICKET_ID_MAX];
    buf[..len].copy_from_slice(field.as_bytes());
    Some(String::from_utf8_lossy(&buf[..len]).into_owned())
}

/// Strict non-negative decimal. Rust's `parse` would accept `+1`, and we want
/// neither that nor leading space nor anything past the declared exact bound.
fn parse_u63(s: &str) -> Option<i64> {
    if s.is_empty() {
        return None;
    }
    let mut v: i64 = 0;
    for b in s.bytes() {
        if !b.is_ascii_digit() {
            return None;
        }
        let d = i64::from(b - b'0');
        if v > (EXACT_MAX - d) / 10 {
            return None; // beyond the declared exact bound: not a ticket we issued
        }
        v = v * 10 + d;
    }
    Some(v)
}

fn is_lower_hex(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `None` if the blob is not a well-formed ticket; the caller then reports `-`
/// as the ticket id.
pub fn parse_blob(blob: &str) -> Option<Ticket> {
    if blob.is_empty() || blob.len() > BLOB_MAX {
        return None;
    }
    // Six fields, five separators, no more and no fewer.
    let parts: Vec<&str> = blob.split('|').collect();
    if parts.len() != 6 {
        return None;
    }
    let mut t = Ticket {
        ticket_id: take_field(parts[0], TICKET_ID_MAX)?,
        event_id: take_field(parts[1], EVENT_ID_MAX)?,
        seat_id: take_field(parts[2], SEAT_ID_MAX)?,
        valid_from: 0,
        valid_to: 0,
        signature: String::new(),
    };
    t.valid_from = parse_u63(parts[3])?;
    t.valid_to = parse_u63(parts[4])?;
    // An inverted window is not a window. It is also the shape a hand-edited
    // blob takes when somebody swaps two fields by mistake.
    if t.valid_from > t.valid_to {
        return None;
    }
    t.signature = take_field(parts[5], SIG_HEX)?;
    if t.signature.len() != SIG_HEX || !is_lower_hex(&t.signature) {
        return None;
    }
    Some(t)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARENA_FROM: i64 = 1_788_282_000;
    const ARENA_TO: i64 = 1_788_300_000;

    pub fn signed_blob(tid: &str, eid: &str, sid: &str, from: i64, to: i64) -> String {
        // TODO(FEAT-1112): tickets cannot be signed yet, so these blobs carry a
        // placeholder signature that only has the right shape.
        format!("{tid}|{eid}|{sid}|{from}|{to}|0000000000000000")
    }

    #[test]
    fn a_generated_blob_parses() {
        let blob = signed_blob(
            "tkt_arena_A01-01",
            "event_arena_2000",
            "seat_arena_A01-01",
            ARENA_FROM,
            ARENA_TO,
        );
        let t = parse_blob(&blob).expect("parses");
        assert_eq!(t.ticket_id, "tkt_arena_A01-01");
        assert_eq!(t.valid_from, ARENA_FROM);
    }

    #[test]
    fn the_parser_refuses_everything_that_is_not_a_ticket() {
        for bad in [
            "",
            "a|b|c",
            "a|b|c|1|2|3|4",
            "a|b|c|1|2|",
            "a|b|c||2|0123456789abcdef",
            "a|b|c|x|2|0123456789abcdef",
            "a|b|c|-1|2|0123456789abcdef",
            "a|b|c|+1|2|0123456789abcdef",
            "a|b|c|5|2|0123456789abcdef",
            "a|b|c|1|2|0123456789ABCDEF",
            "a|b|c|1|2|0123456789abcde",
            "a|b|c|99999999999999999999|2|0123456789abcdef",
        ] {
            assert!(parse_blob(bad).is_none(), "should have refused {bad:?}");
        }
    }

    #[test]
    fn an_over_long_field_is_refused_on_its_length() {
        // Rule SCAN-R13. The 200-byte id sits inside a blob that is UNDER the
        // 256-byte blob maximum, so the blob-length gate lets it through and
        // the field-length check is the only thing standing there.
        let long_id = format!("tkt_{}", "X".repeat(196));
        let blob = signed_blob(&long_id, "e", "s", ARENA_FROM, ARENA_TO);
        assert!(blob.len() <= BLOB_MAX, "the blob itself must be legal");
        assert!(parse_blob(&blob).is_none());

        let longer = format!("tkt_arena_{}", "X".repeat(300));
        assert!(parse_blob(&signed_blob(&longer, "event_arena_2000", "s", ARENA_FROM, ARENA_TO)).is_none());
        assert!(parse_blob(&"Z".repeat(999)).is_none());
        let long_event = format!("event_{}", "e".repeat(40));
        assert!(parse_blob(&signed_blob("tkt_a", &long_event, "s", ARENA_FROM, ARENA_TO)).is_none());
    }
}
