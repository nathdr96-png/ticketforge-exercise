//! The device's flash.
//!
//! Everything the scanner knows lives in one state directory and is written
//! there BEFORE the decision that produced it is announced on stdout
//! (rule SCAN-R03). Nothing is kept only in memory, because the thing this
//! device is for is being power-cycled at a turnstile.
//!
//! File formats: `contract/scanner/interface.yaml`, `state_dir`.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::ticket::{EVENT_ID_MAX, TICKET_ID_MAX};

/// Declared in precedence order, which is also the order `refused_by_reason` is
/// written in. Do not reorder without changing
/// `contract/scanner/interface.yaml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Malformed,
    BadSignature,
    NotCommissioned,
    WrongEvent,
    Duplicate,
    NoTrustedTime,
    NotYetValid,
    Expired,
    Ok,
}

pub const REASONS: [Reason; 9] = [
    Reason::Malformed,
    Reason::BadSignature,
    Reason::NotCommissioned,
    Reason::WrongEvent,
    Reason::Duplicate,
    Reason::NoTrustedTime,
    Reason::NotYetValid,
    Reason::Expired,
    Reason::Ok,
];

impl Reason {
    pub fn name(self) -> &'static str {
        match self {
            Reason::Malformed => "MALFORMED",
            Reason::BadSignature => "BAD_SIGNATURE",
            Reason::NotCommissioned => "NOT_COMMISSIONED",
            Reason::WrongEvent => "WRONG_EVENT",
            Reason::Duplicate => "DUPLICATE",
            Reason::NoTrustedTime => "NO_TRUSTED_TIME",
            Reason::NotYetValid => "NOT_YET_VALID",
            Reason::Expired => "EXPIRED",
            Reason::Ok => "OK",
        }
    }

    fn from_name(name: &str) -> Reason {
        REASONS
            .iter()
            .copied()
            .find(|r| r.name() == name)
            .unwrap_or(Reason::Malformed)
    }

    fn index(self) -> usize {
        REASONS.iter().position(|r| *r == self).unwrap_or(0)
    }
}

#[derive(Debug, Clone)]
pub struct Record {
    pub record_id: u64,
    /// `-` when the blob never parsed.
    pub ticket_id: String,
    /// Trusted time, or -1 if there is none.
    pub scanned_at: i64,
    pub admitted: bool,
    pub reason: Reason,
}

impl Record {
    fn line(&self) -> String {
        format!(
            "{} {} {} {} {}\n",
            self.record_id,
            if self.ticket_id.is_empty() { "-" } else { &self.ticket_id },
            self.scanned_at,
            if self.admitted { "ADMIT" } else { "REFUSE" },
            self.reason.name()
        )
    }
}

#[derive(Debug, Clone)]
pub struct Admit {
    pub ticket_id: String,
    pub admitted_at: i64,
    pub from_replay: bool,
}

pub struct State {
    dir: PathBuf,
    pub queue_max: usize,

    // ---- persisted scalars ----
    /// Empty until GATE commissions it.
    pub gate_event_id: String,
    pub link_up: bool,
    /// `None` until authoritative time has been obtained at least once.
    pub trusted_epoch: Option<i64>,
    pub trusted_anchor_mono: i64,
    pub mono: i64,
    pub wall: i64,

    // Counters are exact to 2^53-1 (rule SCAN-R15).
    pub next_seq: u64,
    pub next_record_id: u64,
    pub scans_total: u64,
    /// THIS door's admissions; a replay never moves it.
    pub admitted_total: u64,
    pub refused_total: u64,
    pub queued_total: u64,
    pub uploaded_total: u64,
    pub queue_evicted_total: u64,
    pub replay_total: u64,
    pub replay_absorbed_total: u64,
    pub sync_offline_total: u64,
    pub time_rejected_total: u64,
    pub unknown_event_total: u64,
    pub refused_by_reason: [u64; 9],

    /// The admitted set. Never evicted: it is the authority for "already used".
    admitted: HashMap<String, Admit>,
    /// The offline queue: a bounded FIFO.
    queue: VecDeque<Record>,

    // Not yet appended to the two append-only logs. admitted.log and
    // uploaded.log are append-only (rule SCAN-R17), so they cannot be rewritten
    // the way counters.json and queue.log are. What is new since the last
    // persist waits here, and `persist` appends it. Both are emptied by every
    // persist, so they never grow.
    pending_admit: Vec<Admit>,
    pending_upload: Vec<Record>,
}

/// Replace a file's whole contents. tmp + fsync + rename, so a reader never
/// sees a half-written file: counters.json and queue.log are both rewritten in
/// full on every event and a torn one would be worse than a stale one.
fn write_whole(path: &Path, data: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn append(path: &Path, data: &str) -> std::io::Result<()> {
    if data.is_empty() {
        return Ok(());
    }
    let mut f = fs::OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(data.as_bytes())?;
    f.sync_all()
}

// ------------------------------------------------------- a very small JSON
//
// counters.json is written by this program and read back by this program, so a
// full parser (or a dependency that is one) would be a liability rather than an
// asset: more code to get wrong on a device with no way to report an error.
// These helpers find a top-level key and read the scalar after it, and anything
// they cannot understand leaves the caller's default in place.

fn find_key<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{key}\"");
    let at = json.find(&needle)? + needle.len();
    let rest = json[at..].trim_start();
    let rest = rest.strip_prefix(':')?;
    Some(rest.trim_start())
}

fn json_u64(json: &str, key: &str, out: &mut u64) {
    if let Some(v) = find_key(json, key) {
        let digits: String = v.chars().take_while(char::is_ascii_digit).collect();
        if let Ok(n) = digits.parse::<u64>() {
            *out = n;
        }
    }
}

fn json_i64(json: &str, key: &str, out: &mut i64) {
    if let Some(v) = find_key(json, key) {
        let mut text = String::new();
        let mut chars = v.chars();
        if let Some('-') = v.chars().next() {
            text.push('-');
            chars.next();
        }
        text.extend(chars.take_while(char::is_ascii_digit));
        if let Ok(n) = text.trim_start_matches('-').parse::<i64>() {
            *out = if text.starts_with('-') { -n } else { n };
        }
    }
}

fn json_opt_i64(json: &str, key: &str) -> Option<i64> {
    let v = find_key(json, key)?;
    if v.starts_with("null") {
        return None;
    }
    let mut parsed = 0i64;
    json_i64(json, key, &mut parsed);
    Some(parsed)
}

fn json_bool(json: &str, key: &str, out: &mut bool) {
    if let Some(v) = find_key(json, key) {
        *out = v.starts_with("true");
    }
}

fn json_string(json: &str, key: &str, out: &mut String) {
    if let Some(v) = find_key(json, key) {
        if v.starts_with("null") {
            out.clear();
            return;
        }
        if let Some(body) = v.strip_prefix('"') {
            if let Some(end) = body.find('"') {
                *out = body[..end].to_string();
            }
        }
    }
}

impl State {
    /// Read the state directory, creating it if it is not there.
    pub fn open(dir: &Path, queue_max: usize) -> std::io::Result<State> {
        fs::create_dir_all(dir)?;
        let mut st = State {
            dir: dir.to_path_buf(),
            queue_max,
            gate_event_id: String::new(),
            link_up: false,
            trusted_epoch: None,
            trusted_anchor_mono: 0,
            mono: 0,
            wall: 0,
            next_seq: 1,
            next_record_id: 1,
            scans_total: 0,
            admitted_total: 0,
            refused_total: 0,
            queued_total: 0,
            uploaded_total: 0,
            queue_evicted_total: 0,
            replay_total: 0,
            replay_absorbed_total: 0,
            sync_offline_total: 0,
            time_rejected_total: 0,
            unknown_event_total: 0,
            refused_by_reason: [0; 9],
            admitted: HashMap::new(),
            queue: VecDeque::new(),
            pending_admit: Vec::new(),
            pending_upload: Vec::new(),
        };

        if let Ok(json) = fs::read_to_string(dir.join("counters.json")) {
            st.load_counters(&json);
        }
        if let Ok(text) = fs::read_to_string(dir.join("admitted.log")) {
            st.load_admitted(&text);
        }
        if let Ok(text) = fs::read_to_string(dir.join("queue.log")) {
            st.load_queue(&text);
        }
        // queue_depth and admitted_known are deliberately NOT read back from
        // counters.json: the two logs are the evidence and the summary is
        // derived from them. A disagreement then resolves in favour of what is
        // actually on the flash instead of in favour of whichever file was
        // written last.
        Ok(st)
    }

    fn load_counters(&mut self, json: &str) {
        json_string(json, "gate_event_id", &mut self.gate_event_id);
        json_bool(json, "link_up", &mut self.link_up);
        self.trusted_epoch = json_opt_i64(json, "trusted_epoch");
        json_i64(json, "trusted_anchor_mono", &mut self.trusted_anchor_mono);
        json_i64(json, "mono", &mut self.mono);
        json_i64(json, "wall", &mut self.wall);
        json_u64(json, "next_seq", &mut self.next_seq);
        json_u64(json, "next_record_id", &mut self.next_record_id);
        json_u64(json, "scans_total", &mut self.scans_total);
        json_u64(json, "admitted_total", &mut self.admitted_total);
        json_u64(json, "refused_total", &mut self.refused_total);
        json_u64(json, "queued_total", &mut self.queued_total);
        json_u64(json, "uploaded_total", &mut self.uploaded_total);
        json_u64(json, "queue_evicted_total", &mut self.queue_evicted_total);
        json_u64(json, "replay_total", &mut self.replay_total);
        json_u64(json, "replay_absorbed_total", &mut self.replay_absorbed_total);
        json_u64(json, "sync_offline_total", &mut self.sync_offline_total);
        json_u64(json, "time_rejected_total", &mut self.time_rejected_total);
        json_u64(json, "unknown_event_total", &mut self.unknown_event_total);

        if let Some(at) = json.find("\"refused_by_reason\"") {
            let block = &json[at..];
            let end = block.find('}').map_or(block.len(), |i| i + 1);
            let block = &block[..end];
            for (i, r) in REASONS.iter().enumerate() {
                json_u64(block, r.name(), &mut self.refused_by_reason[i]);
            }
        }
    }

    fn load_admitted(&mut self, text: &str) {
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let f: Vec<&str> = line.split(' ').collect();
            if f.len() != 3 {
                continue;
            }
            if let Ok(at) = f[1].parse::<i64>() {
                self.admitted.insert(
                    f[0].to_string(),
                    Admit {
                        ticket_id: f[0].to_string(),
                        admitted_at: at,
                        from_replay: f[2] == "REPLAY",
                    },
                );
            }
        }
    }

    fn load_queue(&mut self, text: &str) {
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let f: Vec<&str> = line.split(' ').collect();
            if f.len() != 5 {
                continue;
            }
            let (Ok(record_id), Ok(scanned_at)) = (f[0].parse::<u64>(), f[1 + 1].parse::<i64>())
            else {
                continue;
            };
            let rec = Record {
                record_id,
                ticket_id: f[1].to_string(),
                scanned_at,
                admitted: f[3] == "ADMIT",
                reason: Reason::from_name(f[4]),
            };
            self.queue_push(&rec);
        }
    }

    /// The last authoritative time carried forward by monotonic elapsed time
    /// (rule SCAN-R09). `-1` when no trusted time has ever been obtained.
    pub fn trusted_now(&self) -> i64 {
        match self.trusted_epoch {
            None => -1,
            Some(epoch) => epoch + (self.mono - self.trusted_anchor_mono),
        }
    }

    pub fn admitted_contains(&self, ticket_id: &str) -> bool {
        self.admitted.contains_key(ticket_id)
    }

    pub fn admitted_known(&self) -> usize {
        self.admitted.len()
    }

    pub fn queue_depth(&self) -> usize {
        self.queue.len()
    }

    #[cfg(test)]
    pub fn queue_front_id(&self) -> Option<u64> {
        self.queue.front().map(|r| r.record_id)
    }

    /// `true` if the ticket was new to this device, `false` if it was already
    /// admitted — in which case absolutely nothing changes (rule SCAN-R06).
    pub fn admitted_insert(&mut self, ticket_id: &str, at: i64, from_replay: bool) -> bool {
        if self.admitted.contains_key(ticket_id) {
            return false;
        }
        let entry = Admit {
            ticket_id: ticket_id.to_string(),
            admitted_at: at,
            from_replay,
        };
        self.admitted.insert(ticket_id.to_string(), entry.clone());
        self.pending_admit.push(entry);
        true
    }

    /// Append a scan to the offline queue (rule SCAN-R07).
    pub fn queue_push(&mut self, rec: &Record) {
        if self.queue.len() >= self.queue_max {
            // Never drop a record: give the queue more room instead.
            self.queue.reserve(self.queue_max);
        }
        self.queue.push_back(rec.clone());
    }

    /// Hand the whole queue upstream, in order, and clear it. A no-op with the
    /// link down.
    pub fn queue_upload(&mut self) -> usize {
        if !self.link_up {
            self.sync_offline_total += 1;
            return 0;
        }
        let mut sent = 0;
        while let Some(rec) = self.queue.pop_front() {
            self.pending_upload.push(rec);
            self.uploaded_total += 1;
            sent += 1;
        }
        sent
    }

    fn counters_json(&self) -> String {
        let mut out = String::from("{\n");
        match self.gate_event_id.is_empty() {
            true => out.push_str("  \"gate_event_id\": null,\n"),
            false => out.push_str(&format!(
                "  \"gate_event_id\": \"{}\",\n",
                self.gate_event_id
            )),
        }
        out.push_str(&format!("  \"link_up\": {},\n", self.link_up));
        match self.trusted_epoch {
            None => out.push_str("  \"trusted_epoch\": null,\n"),
            Some(e) => out.push_str(&format!("  \"trusted_epoch\": {e},\n")),
        }
        out.push_str(&format!(
            "  \"trusted_anchor_mono\": {},\n",
            self.trusted_anchor_mono
        ));
        out.push_str(&format!("  \"mono\": {},\n", self.mono));
        out.push_str(&format!("  \"wall\": {},\n", self.wall));
        out.push_str(&format!("  \"next_seq\": {},\n", self.next_seq));
        out.push_str(&format!(
            "  \"next_record_id\": {},\n",
            self.next_record_id
        ));
        out.push_str(&format!("  \"scans_total\": {},\n", self.scans_total));
        out.push_str(&format!("  \"admitted_total\": {},\n", self.admitted_total));
        out.push_str(&format!("  \"refused_total\": {},\n", self.refused_total));
        out.push_str("  \"refused_by_reason\": {");
        let mut first = true;
        for (i, r) in REASONS.iter().enumerate() {
            if self.refused_by_reason[i] == 0 {
                continue;
            }
            out.push_str(&format!(
                "{}\n    \"{}\": {}",
                if first { "" } else { "," },
                r.name(),
                self.refused_by_reason[i]
            ));
            first = false;
        }
        out.push_str(if first { "},\n" } else { "\n  },\n" });
        out.push_str(&format!("  \"queued_total\": {},\n", self.queued_total));
        out.push_str(&format!("  \"uploaded_total\": {},\n", self.uploaded_total));
        out.push_str(&format!(
            "  \"queue_evicted_total\": {},\n",
            self.queue_evicted_total
        ));
        out.push_str(&format!("  \"queue_depth\": {},\n", self.queue_depth()));
        out.push_str(&format!("  \"replay_total\": {},\n", self.replay_total));
        out.push_str(&format!(
            "  \"replay_absorbed_total\": {},\n",
            self.replay_absorbed_total
        ));
        out.push_str(&format!(
            "  \"admitted_known\": {},\n",
            self.admitted_known()
        ));
        out.push_str(&format!(
            "  \"sync_offline_total\": {},\n",
            self.sync_offline_total
        ));
        out.push_str(&format!(
            "  \"time_rejected_total\": {},\n",
            self.time_rejected_total
        ));
        out.push_str(&format!(
            "  \"unknown_event_total\": {},\n",
            self.unknown_event_total
        ));
        out.push_str(&format!("  \"queue_max\": {}\n}}\n", self.queue_max));
        out
    }

    /// Persist every file. Called after each event and before the decision for
    /// it is written, which is the whole of rule SCAN-R03.
    ///
    /// Order matters. The two append-only logs go first, then the queue, then
    /// counters.json last: counters.json is the summary, so if the power goes
    /// mid-persist the summary is the thing that is stale rather than the
    /// evidence being the thing that is missing.
    pub fn persist(&mut self) -> std::io::Result<()> {
        if !self.pending_admit.is_empty() {
            let mut buf = String::new();
            for a in &self.pending_admit {
                buf.push_str(&format!(
                    "{} {} {}\n",
                    a.ticket_id,
                    a.admitted_at,
                    if a.from_replay { "REPLAY" } else { "LOCAL" }
                ));
            }
            append(&self.dir.join("admitted.log"), &buf)?;
            self.pending_admit.clear();
        }
        if !self.pending_upload.is_empty() {
            let mut buf = String::new();
            for r in &self.pending_upload {
                buf.push_str(&r.line());
            }
            append(&self.dir.join("uploaded.log"), &buf)?;
            self.pending_upload.clear();
        }
        // The queue is bounded, so the whole of it is rewritten in full.
        // Eviction is then simply "it is not in the file any more", with no
        // compaction pass to get wrong.
        let mut queue_buf = String::new();
        for rec in &self.queue {
            queue_buf.push_str(&rec.line());
        }
        write_whole(&self.dir.join("queue.log"), &queue_buf)?;
        write_whole(&self.dir.join("counters.json"), &self.counters_json())
    }

    pub fn count_refusal(&mut self, reason: Reason) {
        self.refused_total += 1;
        self.refused_by_reason[reason.index()] += 1;
    }

    pub fn commission(&mut self, event_id: &str) -> bool {
        if event_id.is_empty() || event_id.len() > EVENT_ID_MAX {
            return false;
        }
        self.gate_event_id = event_id.to_string();
        true
    }

    pub fn ticket_id_fits(id: &str) -> bool {
        !id.is_empty() && id.len() <= TICKET_ID_MAX
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT_DOOR: i64 = 1_788_285_600;

    fn tmpdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tf-rust-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn record(id: u64, ticket: &str) -> Record {
        Record {
            record_id: id,
            ticket_id: ticket.to_string(),
            scanned_at: AT_DOOR,
            admitted: true,
            reason: Reason::Ok,
        }
    }

    #[test]
    fn the_queue_is_bounded_and_every_eviction_is_counted() {
        let dir = tmpdir("queue");
        let mut st = State::open(&dir, 4).expect("opens");
        st.link_up = false;
        for i in 1..=10u64 {
            st.queue_push(&record(i, &format!("tkt_{i}")));
            st.queued_total += 1;
        }
        assert_eq!(st.queue_depth(), 4, "bounded at 4");
        assert_eq!(st.queue_evicted_total, 6, "six evictions, counted");
        assert_eq!(st.queue_front_id(), Some(7), "the oldest survivor is 7");

        assert_eq!(st.queue_upload(), 0, "an offline sync uploads nothing");
        assert_eq!(st.queue_depth(), 4, "and leaves the queue intact");
        assert_eq!(st.sync_offline_total, 1);

        st.link_up = true;
        assert_eq!(st.queue_upload(), 4, "an online sync uploads the whole queue");
        assert_eq!(st.queue_depth(), 0);
        assert_eq!(st.queue_upload(), 0, "a second sync uploads nothing");
        assert_eq!(st.pending_upload[0].record_id, 7, "FIFO: oldest first");
        assert_eq!(st.pending_upload[3].record_id, 10);
        // The conservation law of rule SCAN-R08, on the structure itself.
        assert_eq!(
            st.queued_total,
            st.uploaded_total + st.queue_depth() as u64 + st.queue_evicted_total
        );
        st.persist().expect("persists");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn everything_survives_a_reopen() {
        let dir = tmpdir("persist");
        {
            let mut st = State::open(&dir, 8).expect("opens");
            st.commission("event_arena_2000");
            st.link_up = true;
            st.trusted_epoch = Some(AT_DOOR);
            st.next_seq = 41;
            st.next_record_id = 91;
            assert!(st.admitted_insert("tkt_arena_A01-01", AT_DOOR, false));
            assert!(
                !st.admitted_insert("tkt_arena_A01-01", AT_DOOR, false),
                "re-inserting the same ticket changes nothing"
            );
            assert!(st.admitted_insert("tkt_arena_B05-07", AT_DOOR - 100, true));
            st.queue_push(&record(91, "tkt_arena_A01-02"));
            st.queued_total += 1;
            st.persist().expect("persists");
        }
        // A new process against the same flash: rule SCAN-R02.
        let st = State::open(&dir, 8).expect("reopens");
        assert_eq!(st.gate_event_id, "event_arena_2000");
        assert!(st.link_up);
        assert_eq!(st.trusted_now(), AT_DOOR);
        assert_eq!(st.next_seq, 41);
        assert_eq!(st.next_record_id, 91);
        assert!(st.admitted_contains("tkt_arena_A01-01"));
        assert!(st.admitted_contains("tkt_arena_B05-07"));
        assert!(!st.admitted_contains("tkt_arena_A01-09"));
        assert_eq!(st.admitted_known(), 2);
        assert_eq!(st.queue_depth(), 1);
        assert_eq!(st.queue_front_id(), Some(91));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn counters_cross_the_32_bit_boundary_through_a_round_trip() {
        let dir = tmpdir("counters");
        {
            let mut st = State::open(&dir, 8).expect("opens");
            st.commission("event_arena_2000");
            st.trusted_epoch = Some(AT_DOOR);
            st.next_seq = 4_294_967_295;
            st.next_record_id = 281_474_976_710_655;
            st.scans_total = 4_294_967_295;
            let a = st.next_seq;
            st.next_seq += 1;
            let b = st.next_seq;
            st.next_seq += 1;
            assert_eq!(a, 4_294_967_295, "the last 32-bit sequence number");
            assert_eq!(b, 4_294_967_296, "and the first past it, not zero");
            st.scans_total += 2;
            st.persist().expect("persists at the boundary");
        }
        let st = State::open(&dir, 8).expect("reopens");
        assert_eq!(st.next_seq, 4_294_967_297);
        assert_eq!(st.scans_total, 4_294_967_297);
        assert_eq!(st.next_record_id, 281_474_976_710_655);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_trusted_clock_ignores_the_wall_clock() {
        let dir = tmpdir("clock");
        let mut st = State::open(&dir, 8).expect("opens");
        st.trusted_epoch = Some(AT_DOOR);
        assert_eq!(st.trusted_now(), AT_DOOR);
        st.wall = 1_893_456_000; // the coin cell dies and the clock reads 2030
        assert_eq!(st.trusted_now(), AT_DOOR);
        st.wall = 0;
        assert_eq!(st.trusted_now(), AT_DOOR);
        st.mono += 3600;
        assert_eq!(st.trusted_now(), AT_DOOR + 3600, "elapsed time does move it");
        st.trusted_epoch = None;
        assert_eq!(st.trusted_now(), -1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_admitted_set_grows_without_losing_anything() {
        let dir = tmpdir("grow");
        let mut st = State::open(&dir, 8).expect("opens");
        for i in 0..500 {
            assert!(st.admitted_insert(&format!("tkt_arena_X{i:03}-01"), AT_DOOR, false));
        }
        assert_eq!(st.admitted_known(), 500);
        for i in 0..500 {
            assert!(st.admitted_contains(&format!("tkt_arena_X{i:03}-01")));
        }
        assert!(!st.admitted_contains("tkt_arena_X500-01"));
        let _ = fs::remove_dir_all(&dir);
    }
}
