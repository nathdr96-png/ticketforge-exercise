import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  admitted,
  blob,
  counters,
  decisions,
  delta,
  deviceInfo,
  exitCodes,
  expectedDecisions,
  initialCounters,
  int,
  loadScenarios,
  outDir,
  queued,
  scannerBin,
  scans,
  scenarioDir,
  stderrOf,
  syncs,
  uploaded,
  type Counters,
} from "./contract.js";
import { decisionLines, reasonsOf, runSegment, withTempState } from "./probe.js";

/**
 * Black-box conformance for the edge/scanner family.
 *
 * The suite never reads an implementation. It reads the **output directory** a
 * scanner wrote: the decision stream it printed, the state files it left behind,
 * the exit status of every segment and what it put on stderr. A C scanner, a
 * Rust scanner and a MicroPython scanner are therefore graded by exactly the
 * same bar, because they are driven by the same
 * contract/scanner/run-scenarios.sh.
 *
 * Every test names the rule id it asserts, from contract/scanner/rules.yaml. The
 * expected decision streams in ./expected/ are GENERATED, never hand-edited, and
 * committed.
 *
 * Some rules could not be graded objectively at all — those are written down in
 * contract/scanner/rules.yaml under `not_graded` rather than quietly dropped.
 */

const SCENARIOS = loadScenarios();
const DECLARED_REASONS = new Set([
  "OK",
  "DUPLICATE",
  "NOT_YET_VALID",
  "EXPIRED",
  "WRONG_EVENT",
  "BAD_SIGNATURE",
  "MALFORMED",
  "NO_TRUSTED_TIME",
  "NOT_COMMISSIONED",
]);

/** The arena window, derived in contract/scanner/make-fixtures.py from
 * contract/seed: event_arena_2000 starts at 19:00 UTC on 2026-09-01. */
const ARENA_FROM = 1788282000;
const ARENA_TO = 1788300000;
const AT_DOOR = 1788285600;

describe("edge: the device and the run", () => {
  it("every declared scenario produced the declared output files", () => {
    const dir = outDir();
    expect(fs.existsSync(path.join(dir, "manifest.tsv")), `no manifest.tsv in ${dir}`).toBe(true);
    const missing: string[] = [];
    for (const s of SCENARIOS) {
      for (const f of ["decisions.txt", "stderr.log", "exit-codes.txt", "state/counters.json"]) {
        if (!fs.existsSync(path.join(dir, s.id, f))) missing.push(`${s.id}/${f}`);
      }
      for (let i = 1; i <= s.segments; i++) {
        const seg = String(i).padStart(2, "0");
        if (!fs.existsSync(path.join(dir, s.id, `after-${seg}`, "counters.json"))) {
          missing.push(`${s.id}/after-${seg}/counters.json`);
        }
      }
    }
    expect(missing, "run `make run` in the slot — it writes every declared scenario").toEqual([]);
  });

  it("every segment of every scenario ran all its segments and exited 0 (SCAN-R14)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const codes = exitCodes(s.id);
      if (codes.length !== s.segments) {
        bad.push(`${s.id}: ran ${codes.length} of ${s.segments} segment(s)`);
      }
      for (const c of codes) {
        if (c.code !== 0) bad.push(`${s.id} segment ${c.segment}: exit ${c.code}`);
      }
    }
    expect(bad, "a non-zero exit is a crash, an abort, or a sanitizer finding").toEqual([]);
  });

  it("no segment wrote anything to stderr (SCAN-R14)", () => {
    // This is the memory-safety measurement, not a tidiness check. stderr is the
    // channel AddressSanitizer, UndefinedBehaviorSanitizer and a Rust panic use,
    // so anything here is either a sanitizer finding or a device that made the
    // finding impossible to see.
    const noisy: string[] = [];
    for (const s of SCENARIOS) {
      const err = stderrOf(s.id).trim();
      if (err !== "") noisy.push(`${s.id}:\n${err.slice(0, 1200)}`);
    }
    expect(noisy, "stderr belongs to the sanitizers — see contract/scanner/rules.yaml SCAN-R14").toEqual(
      []
    );
  });

  it("was built with a memory-safety mechanism this family accepts (SCAN-R14)", () => {
    // "stderr was empty" only means something if something was watching. The
    // mechanism is detected from the binary by contract/scanner/run-scenarios.sh,
    // never declared by the slot: either the sanitizer runtimes are linked in,
    // or the bounds and overflow checks are in the language and cannot be
    // dropped from a build.
    const info = deviceInfo();
    const found = (info.memory_safety ?? "none").split(",").filter((x) => x !== "");
    expect(
      found.some((m) => m === "asan" || m === "rust"),
      `device.txt reports memory_safety=${info.memory_safety ?? "(absent)"} — ` +
        "an uninstrumented C build makes an empty stderr meaningless"
    ).toBe(true);
  });
});

describe("edge: the decision stream", () => {
  it.each(SCENARIOS.map((s) => [s.id, s.title] as const))(
    "%s decides exactly what the contract says",
    (id) => {
      expect(decisions(id)).toEqual(expectedDecisions(id));
    }
  );
});

describe("edge: a ticket is admitted once, and stays admitted", () => {
  it("no ticket is admitted twice in any scenario (SCAN-R01)", () => {
    const doubled: string[] = [];
    for (const s of SCENARIOS) {
      const seen = new Set<string>();
      for (const scan of scans(decisions(s.id))) {
        if (scan.verdict !== "ADMIT") continue;
        if (seen.has(scan.ticketId)) doubled.push(`${s.id}: ${scan.ticketId} at seq ${scan.seq}`);
        seen.add(scan.ticketId);
      }
    }
    expect(doubled, "one seat admits one person").toEqual([]);
  });

  it("a clean restart refuses a ticket the previous process admitted (SCAN-R02)", () => {
    const got = scans(decisions("s03-restart-remembers"));
    // Segment 1 admitted three; segment 2 is a new process with an empty memory.
    expect(got.slice(0, 3).map((s) => s.reason)).toEqual(["OK", "OK", "OK"]);
    expect({ ticket: got[3].ticketId, reason: got[3].reason }).toEqual({
      ticket: "tkt_arena_A01-01",
      reason: "DUPLICATE",
    });
    expect(got[4].reason, "and a new ticket still gets in after the restart").toBe("OK");
  });

  it("the gate, the link and the time anchor all survive a restart (SCAN-R02)", () => {
    // Nothing in segment 2 of s03 re-commissions the gate or re-fetches the
    // time, and its first scan is still decided — so all three came off the
    // flash. A device that keeps commissioning in RAM answers
    // NOT_COMMISSIONED or NO_TRUSTED_TIME here.
    const got = scans(decisions("s03-restart-remembers"));
    expect(got[3].reason).not.toBe("NOT_COMMISSIONED");
    expect(got[3].reason).not.toBe("NO_TRUSTED_TIME");
    const c = counters("s03-restart-remembers", "after-01");
    expect(c.gate_event_id).toBe("event_arena_2000");
    expect(c.trusted_epoch).not.toBeNull();
  });

  it("an unclean power loss refuses a ticket the previous process admitted (SCAN-R03)", () => {
    // s04 kills the process with ABORT — no flush, no exit handler — straight
    // after an admission. A device that batches its writes passes s03 and fails
    // here, which is the bug worth catching: invisible until the mains go.
    const got = scans(decisions("s04-power-loss"));
    expect(got.map((s) => s.reason)).toEqual([
      "OK",
      "OK",
      "DUPLICATE",
      "DUPLICATE",
      "OK",
    ]);
    expect(got[3].ticketId).toBe("tkt_arena_A01-01");
  });

  it("the sequence number survives an unclean power loss (SCAN-R03)", () => {
    const got = scans(decisions("s04-power-loss"));
    expect(got.map((s) => s.seq)).toEqual([1n, 2n, 3n, 4n, 5n]);
  });
});

describe("edge: the offline queue", () => {
  it("offline scans are uploaded in FIFO order, exactly once (SCAN-R04)", () => {
    const up = uploaded("s05-offline-queue-and-sync");
    expect(up.length, "thirteen scans were taken, so thirteen records went up").toBe(13);
    const ids = up.map((r) => r.recordId);
    expect([...new Set(ids.map(String))].length, "no record was uploaded twice").toBe(13);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1], `record ${ids[i]} followed ${ids[i - 1]}`).toBe(true);
    }
    expect(ids[0]).toBe(1n);
    expect(ids[12]).toBe(13n);
  });

  it("a sync with the link down uploads nothing and keeps the queue (SCAN-R05)", () => {
    const s = syncs(decisions("s05-offline-queue-and-sync"));
    expect(s[0], "the first sync happens with the link down").toEqual({ uploaded: 0, depth: 12 });
    expect(int(counters("s05-offline-queue-and-sync"), "sync_offline_total")).toBe(1n);
  });

  it("a second sync uploads nothing (SCAN-R05)", () => {
    const s = syncs(decisions("s05-offline-queue-and-sync"));
    expect(s[1], "the link comes back and twelve records go up").toEqual({ uploaded: 12, depth: 0 });
    expect(s[2], "and the retry behind it uploads nothing").toEqual({ uploaded: 0, depth: 0 });
    expect(syncs(decisions("s01-happy-door")).at(-1)).toEqual({ uploaded: 0, depth: 0 });
  });
});

describe("edge: replay after reconnect", () => {
  it("a replay of a ticket the device already knows changes nothing (SCAN-R06)", () => {
    const c = counters("s08-reconnect-replay-idempotent");
    expect(int(c, "replay_total"), "four records came back from upstream").toBe(4n);
    expect(int(c, "replay_absorbed_total"), "only one of them was new").toBe(1n);
    expect(int(c, "admitted_total"), "a replay never counts as a local admission").toBe(4n);
    // Three replays of two already-known tickets left the evidence untouched.
    const log = admitted("s08-reconnect-replay-idempotent");
    expect(log.filter((e) => e.ticketId === "tkt_arena_A01-01")).toHaveLength(1);
    expect(log.filter((e) => e.ticketId === "tkt_arena_A01-02")).toHaveLength(1);
  });

  it("a replay from another gate is absorbed, and the next local scan is refused (SCAN-R06)", () => {
    const got = scans(decisions("s08-reconnect-replay-idempotent"));
    const far = got.find((s) => s.ticketId === "tkt_arena_B05-07");
    expect(far, "s08 scans tkt_arena_B05-07 after upstream replayed it").toBeDefined();
    expect(far!.reason, "the far door admitted them, so this one must refuse").toBe("DUPLICATE");
    const entry = admitted("s08-reconnect-replay-idempotent").find(
      (e) => e.ticketId === "tkt_arena_B05-07"
    );
    expect(entry?.source, "and it is recorded as having come from a replay").toBe("REPLAY");
  });

  it("a replay never queues a record of its own (SCAN-R06)", () => {
    const s = SCENARIOS.find((x) => x.id === "s08-reconnect-replay-idempotent")!;
    const c = counters(s.id);
    expect(
      delta(c, initialCounters(s), "queued_total"),
      "six scans were taken; the four replays are not scans"
    ).toBe(6n);
  });
});

describe("edge: the queue bound", () => {
  it("the door keeps admitting at the storage bound (SCAN-R07)", () => {
    // Twenty people, room for eight records. Refusing entry because a log is
    // full would be the worse failure.
    const got = scans(decisions("s06-queue-bound"));
    expect(got).toHaveLength(20);
    expect(got.every((s) => s.verdict === "ADMIT" && s.reason === "OK")).toBe(true);
  });

  it("the queue never exceeds its bound and every eviction is counted (SCAN-R07)", () => {
    const s = SCENARIOS.find((x) => x.id === "s06-queue-bound")!;
    const c = counters(s.id);
    expect(int(c, "queue_evicted_total"), "twelve records were dropped").toBe(12n);
    expect(int(c, "uploaded_total"), "and eight survived to go upstream").toBe(8n);
    const bad: string[] = [];
    for (const scen of SCENARIOS) {
      for (let i = 1; i <= scen.segments; i++) {
        const sub = `after-${String(i).padStart(2, "0")}`;
        const depth = queued(scen.id, sub).length;
        if (depth > scen.queueMax) {
          bad.push(`${scen.id}/${sub}: queue.log holds ${depth}, bound is ${scen.queueMax}`);
        }
      }
    }
    expect(bad, "the bound is the device's flash, not a suggestion").toEqual([]);
  });

  it("nothing is evicted in a scenario that never reaches the bound (SCAN-R07)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      if (s.id === "s06-queue-bound") continue;
      const evicted = delta(counters(s.id), initialCounters(s), "queue_evicted_total");
      if (evicted !== 0n) bad.push(`${s.id}: evicted ${evicted} with queue_max ${s.queueMax}`);
    }
    expect(bad, "an eviction that was not needed is a lost reconciliation record").toEqual([]);
  });
});

describe("edge: nothing is lost without being counted", () => {
  it("queued == uploaded + depth + evicted, in every scenario (SCAN-R08)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const c = counters(s.id);
      const init = initialCounters(s);
      const queuedN = delta(c, init, "queued_total");
      const up = delta(c, init, "uploaded_total");
      const evicted = delta(c, init, "queue_evicted_total");
      const depth = int(c, "queue_depth");
      if (queuedN !== up + depth + evicted) {
        bad.push(
          `${s.id}: queued ${queuedN} != uploaded ${up} + depth ${depth} + evicted ${evicted}`
        );
      }
    }
    expect(bad, "every queued record went up, is waiting, or was dropped and counted").toEqual([]);
  });

  it("queue_depth agrees with queue.log, and uploaded_total with uploaded.log (SCAN-R08)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const c = counters(s.id);
      const depth = int(c, "queue_depth");
      const onDisk = BigInt(queued(s.id).length);
      if (depth !== onDisk) bad.push(`${s.id}: counters say depth ${depth}, queue.log has ${onDisk}`);
      const up = delta(c, initialCounters(s), "uploaded_total");
      const upDisk = BigInt(uploaded(s.id).length);
      if (up !== upDisk) {
        bad.push(`${s.id}: counters say ${up} uploaded, uploaded.log has ${upDisk}`);
      }
    }
    expect(bad, "the summary must agree with the evidence").toEqual([]);
  });

  it("scans == admitted + refused, and every scan is queued (SCAN-R16)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const c = counters(s.id);
      const init = initialCounters(s);
      const total = delta(c, init, "scans_total");
      const ok = delta(c, init, "admitted_total");
      const no = delta(c, init, "refused_total");
      const queuedN = delta(c, init, "queued_total");
      const emitted = BigInt(scans(decisions(s.id)).length);
      if (total !== ok + no) bad.push(`${s.id}: scans ${total} != admitted ${ok} + refused ${no}`);
      if (total !== queuedN) bad.push(`${s.id}: ${total} scans but ${queuedN} queued`);
      if (total !== emitted) {
        bad.push(`${s.id}: ${total} scans counted but ${emitted} decision lines printed`);
      }
    }
    expect(bad, "a refused scan is still a scan — the venue asks about both").toEqual([]);
  });

  it("the sequence number increments once per scan and never repeats (SCAN-R16)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const seqs = scans(decisions(s.id)).map((x) => x.seq);
      for (let i = 1; i < seqs.length; i++) {
        if (seqs[i] !== seqs[i - 1] + 1n) {
          bad.push(`${s.id}: seq ${seqs[i - 1]} was followed by ${seqs[i]}`);
        }
      }
      const c = counters(s.id);
      if (seqs.length > 0 && int(c, "next_seq") !== seqs[seqs.length - 1] + 1n) {
        bad.push(`${s.id}: last seq ${seqs[seqs.length - 1]}, next_seq ${int(c, "next_seq")}`);
      }
    }
    expect(bad, "a hole in the door log reads as a lost record").toEqual([]);
  });

  it("admitted_known == local admissions + absorbed replays (SCAN-R08)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const c = counters(s.id);
      const init = initialCounters(s);
      const known = int(c, "admitted_known");
      const local = delta(c, init, "admitted_total");
      const absorbed = delta(c, init, "replay_absorbed_total");
      if (known !== local + absorbed) {
        bad.push(`${s.id}: admitted_known ${known} != local ${local} + absorbed ${absorbed}`);
      }
      if (known !== BigInt(admitted(s.id).length)) {
        bad.push(`${s.id}: admitted_known ${known}, admitted.log has ${admitted(s.id).length}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("edge: the clock is not to be trusted", () => {
  it("a wall-clock jump does not change a single decision (SCAN-R09)", () => {
    // In s07 the local clock reads 2030, then 1970, while the trusted clock
    // stays inside the ticket's signed window. Both scans are admitted.
    const got = scans(decisions("s07-clock-skew"));
    expect(got[2], "scanned while the wall clock read 2030").toMatchObject({
      ticketId: "tkt_arena_A01-02",
      reason: "OK",
    });
    expect(got[3], "scanned while the wall clock read 1970").toMatchObject({
      ticketId: "tkt_arena_A01-03",
      reason: "OK",
    });
    const c = counters("s07-clock-skew");
    expect(
      int(c, "wall") === int(c, "trusted_epoch"),
      "and the two clocks really did disagree, so the scenario tested something"
    ).toBe(false);
  });

  it("authoritative time before the window refuses, whatever the local clock says (SCAN-R09)", () => {
    const got = scans(decisions("s07-clock-skew"));
    expect(got[0], "the wall clock said the doors were open; upstream said otherwise").toMatchObject({
      reason: "NOT_YET_VALID",
    });
    expect(got[1].reason, "and once upstream agrees, the same door admits").toBe("OK");
  });

  it("monotonic elapsed time does expire a ticket, and a corrected clock does not reopen it (SCAN-R09)", () => {
    const got = scans(decisions("s07-clock-skew"));
    expect(got[4].reason, "five hours of elapsed time put the trusted clock past valid_to").toBe(
      "EXPIRED"
    );
    expect(got[5].reason, "setting the wall clock back into the window changes nothing").toBe(
      "EXPIRED"
    );
  });

  it("an already-admitted ticket reads DUPLICATE whatever the clock says (SCAN-R01)", () => {
    const got = scans(decisions("s07-clock-skew"));
    expect(got[6], "the same ticket as scan 2, now long past valid_to").toMatchObject({
      ticketId: "tkt_arena_A01-01",
      reason: "DUPLICATE",
    });
  });
});

describe("edge: everything that is not a valid ticket", () => {
  it("the bad-ticket corpus is refused in the declared precedence order (SCAN-R10, R11, R12)", () => {
    // The title abbreviates a run of ids; spelled out, this asserts SCAN-R10
    // (the signature), SCAN-R11 (the gate, commissioning and trusted time) and
    // SCAN-R12 (malformed input), and the ORDER the contract checks them in.
    // The order is as much the rule as the individual answers: a 200-byte
    // ticket id must be MALFORMED before its signature is looked at, and a
    // correctly signed jazz ticket must be WRONG_EVENT at the arena door.
    const got = scans(decisions("s10-bad-tickets"));
    expect(got.map((s) => s.reason)).toEqual([
      "NOT_COMMISSIONED",
      "NO_TRUSTED_TIME",
      "BAD_SIGNATURE",
      "BAD_SIGNATURE",
      "WRONG_EVENT",
      "MALFORMED",
      "MALFORMED",
      "MALFORMED",
      "MALFORMED",
      "MALFORMED",
      "MALFORMED",
      "OK",
      "DUPLICATE",
    ]);
    expect(
      int(counters("s10-bad-tickets"), "admitted_total"),
      "after all of that, exactly one real ticket got in"
    ).toBe(1n);
  });

  it("a blob that never parsed reports '-' and not a truncated id (SCAN-R12)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      for (const scan of scans(decisions(s.id))) {
        if (scan.reason === "MALFORMED" && scan.ticketId !== "-") {
          bad.push(`${s.id} seq ${scan.seq}: reported ${scan.ticketId.slice(0, 40)}`);
        }
        if (scan.reason !== "MALFORMED" && scan.ticketId === "-") {
          bad.push(`${s.id} seq ${scan.seq}: '-' with reason ${scan.reason}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("an unknown event verb is survived and counted (SCAN-R12)", () => {
    expect(int(counters("s10-bad-tickets"), "unknown_event_total")).toBe(1n);
    const got = scans(decisions("s10-bad-tickets"));
    expect(got.at(-1)?.reason, "and the device kept reading past it").toBe("DUPLICATE");
  });

  it("every reason in the corpus is one the contract declares (SCAN-R12)", () => {
    const bad: string[] = [];
    const reasons = new Set<string>();
    for (const s of SCENARIOS) {
      for (const scan of scans(decisions(s.id))) {
        reasons.add(scan.reason);
        if (!DECLARED_REASONS.has(scan.reason)) bad.push(`${s.id}: ${scan.reason}`);
        if (scan.verdict !== "ADMIT" && scan.verdict !== "REFUSE") {
          bad.push(`${s.id}: verdict ${scan.verdict}`);
        }
        if ((scan.verdict === "ADMIT") !== (scan.reason === "OK")) {
          bad.push(`${s.id}: ${scan.verdict} with reason ${scan.reason}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(
      [...DECLARED_REASONS].filter((r) => !reasons.has(r)),
      "every declared reason is exercised somewhere in the corpus"
    ).toEqual([]);
  });

  it("refused_by_reason agrees with the decision stream (SCAN-R12)", () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const c = counters(s.id) as Counters & { refused_by_reason?: Record<string, number> };
      const table = c.refused_by_reason ?? {};
      const seen: Record<string, number> = {};
      for (const scan of scans(decisions(s.id))) {
        if (scan.verdict === "REFUSE") seen[scan.reason] = (seen[scan.reason] ?? 0) + 1;
      }
      const init = (initialCounters(s).refused_by_reason ?? {}) as Record<string, number>;
      for (const [reason, n] of Object.entries(seen)) {
        const got = (table[reason] ?? 0) - (init[reason] ?? 0);
        if (got !== n) bad.push(`${s.id}: ${reason} counted ${got}, stream shows ${n}`);
      }
      for (const reason of Object.keys(table)) {
        if (!(reason in seen) && (init[reason] ?? 0) === (table[reason] ?? 0)) continue;
        if (!(reason in seen)) bad.push(`${s.id}: ${reason} counted but never refused`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("edge: hostile input the device has never seen", () => {
  it("a transcript built at grade time is refused line by line, and the run comes out clean (SCAN-R13)", () => {
    const bin = scannerBin();
    if (bin === null) {
      throw new Error(
        "SCANNER_BIN is not set — this check feeds the device input that is NOT in " +
          "contract/scanner/scenarios/, so it needs the binary. Set it to the built scanner."
      );
    }

    // Built here rather than shipped, so a parser tuned to the published corpus
    // gets no help. Every entry is [transcript line, the reason expected, or
    // null for a line that produces no decision at all].
    const long = (n: number, c = "A") => c.repeat(n);
    const atMax = `tkt_arena_${long(54)}`; // exactly 64 bytes: valid
    const overMax = `tkt_arena_${long(55)}`; // 65 bytes: not
    const eventAtMax = `event_${long(26, "e")}`; // exactly 32 bytes
    const cases: [string, string | null][] = [
      [`SCAN ${blob(atMax, "event_arena_2000", "seat_arena_A01-01", ARENA_FROM, ARENA_TO)}`, "OK"],
      [`SCAN ${blob(overMax, "event_arena_2000", "seat_arena_A01-01", ARENA_FROM, ARENA_TO)}`, "MALFORMED"],
      // The one that separates "measured the blob" from "measured the field":
      // 200 bytes of ticket id inside a blob that is comfortably under the
      // declared 256-byte maximum, so the blob-length gate lets it through.
      [`SCAN ${blob(`tkt_${long(196)}`, "e", "s", ARENA_FROM, ARENA_TO)}`, "MALFORMED"],
      [`SCAN ${blob("tkt_arena_A01-02", eventAtMax, "seat_arena_A01-02", ARENA_FROM, ARENA_TO)}`, "WRONG_EVENT"],
      [`SCAN ${blob("tkt_arena_A01-03", `${eventAtMax}x`, "seat_arena_A01-03", ARENA_FROM, ARENA_TO)}`, "MALFORMED"],
      [`SCAN ${blob("tkt_arena_A01-04", "event_arena_2000", `seat_${long(28, "s")}`, ARENA_FROM, ARENA_TO)}`, "MALFORMED"],
      [`SCAN ${blob("tkt_arena_A01-05", "event_arena_2000", `seat_${long(400, "s")}`, ARENA_FROM, ARENA_TO)}`, "MALFORMED"],
      ["SCAN ||||||", "MALFORMED"],
      ["SCAN |", "MALFORMED"],
      [`SCAN ${"|".repeat(200)}`, "MALFORMED"],
      ["SCAN a|b|c|1|2|3|4|5|6", "MALFORMED"],
      ["SCAN a|b|c|99999999999999999999|2|0123456789abcdef", "MALFORMED"],
      ["SCAN a|b|c|+1|2|0123456789abcdef", "MALFORMED"],
      ["SCAN a|b|c|1| 2|0123456789abcdef", "MALFORMED"],
      ["SCAN a|b|c|1|2|0123456789abcdeg", "MALFORMED"],
      [`SCAN ${long(1019, "Z")}`, "MALFORMED"], // a 1024-byte line, the declared maximum
      [`SCAN ${long(2000, "Z")}`, null], // over the maximum: skipped, counted, survived
      ["TICK notanumber", null],
      ["NOW", null],
      ["TIME -5", null],
      [`GATE ${long(40, "g")}`, null],
      ["LINK sideways", null],
      ["REPLAY", null],
      [`REPLAY ${long(300)} 1`, null],
      ["ABORTnot", null],
      ["", null],
      ["   ", null],
      [`SCAN ${blob(atMax, "event_arena_2000", "seat_arena_A01-01", ARENA_FROM, ARENA_TO)}`, "DUPLICATE"],
    ];

    const header = ["GATE event_arena_2000", "LINK up", `NOW ${AT_DOOR}`, `TIME ${AT_DOOR}`];
    const transcript = [...header, ...cases.map(([line]) => line)].join("\n");

    const { reasons, run, reloaded } = withTempState((dir) => {
      const first = runSegment(bin, dir, transcript, 8);
      // A second process against the same flash, so the reload path sees
      // whatever the hostile segment left behind.
      const second = runSegment(
        bin,
        dir,
        `SCAN ${blob(atMax, "event_arena_2000", "seat_arena_A01-01", ARENA_FROM, ARENA_TO)}\nSYNC`,
        8
      );
      return { reasons: reasonsOf(first.stdout), run: first, reloaded: second };
    });

    expect(run.stderr, "nothing on stderr, instrumented or not").toBe("");
    expect(run.code, "the device refuses hostile input; it does not fall over on it").toBe(0);
    expect(reasons).toEqual(cases.map(([, r]) => r).filter((r): r is string => r !== null));
    expect(reloaded.stderr, "and the reload after it is clean too").toBe("");
    expect(reloaded.code).toBe(0);
    expect(
      reasonsOf(reloaded.stdout),
      "the admission from the hostile segment was still durable"
    ).toEqual(["DUPLICATE"]);
    expect(decisionLines(reloaded.stdout).at(-1)).toMatch(/^SYNC \d+ 0$/);
  });
});

describe("edge: counters do not wrap", () => {
  it("the sequence number crosses 2^32 exactly (SCAN-R15)", () => {
    const seqs = scans(decisions("s09-counter-bounds")).map((s) => s.seq);
    expect(seqs).toEqual([
      4294967290n, 4294967291n, 4294967292n, 4294967293n, 4294967294n,
      4294967295n, 4294967296n, 4294967297n, 4294967298n, 4294967299n,
    ]);
    expect(int(counters("s09-counter-bounds"), "next_seq")).toBe(4294967300n);
  });

  it("totals carried off the flash continue, rather than restarting (SCAN-R15)", () => {
    const s = SCENARIOS.find((x) => x.id === "s09-counter-bounds")!;
    const c = counters(s.id);
    expect(int(c, "scans_total")).toBe(4294967299n);
    expect(int(c, "uploaded_total")).toBe(4294967299n);
    expect(delta(c, initialCounters(s), "scans_total")).toBe(10n);
  });

  it("record ids cross 2^48 exactly and are never reused (SCAN-R15)", () => {
    const s = SCENARIOS.find((x) => x.id === "s09-counter-bounds")!;
    const c = counters(s.id);
    expect(int(c, "next_record_id")).toBe(281474976710660n);
    expect(
      delta(c, initialCounters(s), "next_record_id"),
      "one record id per scan, consumed and never reused"
    ).toBe(delta(c, initialCounters(s), "queued_total"));
    const ids = uploaded(s.id).map((r) => r.recordId);
    expect(ids[0]).toBe(281474976710650n);
    expect(ids.at(-1)).toBe(281474976710659n);
  });

  it("no counter leaves the exact integer range, in any scenario (SCAN-R15)", () => {
    // int() refuses a value that is not an exact integer or that has left the
    // 2^53-1 range, so this both type-checks counters.json and catches a counter
    // that has been serialised through a float.
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      const c = counters(s.id);
      for (const [key, value] of Object.entries(c)) {
        if (typeof value !== "number") continue;
        try {
          int(c, key);
        } catch (err) {
          bad.push(`${s.id}.${key}: ${(err as Error).message}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("edge: the output directory is the one that was asked for", () => {
  it("refuses to grade when SCAN_OUT_DIR is not set", () => {
    const saved = process.env.SCAN_OUT_DIR;
    try {
      process.env.SCAN_OUT_DIR = "";
      expect(() => outDir()).toThrow(/SCAN_OUT_DIR is not set/);
    } finally {
      process.env.SCAN_OUT_DIR = saved;
    }
  });

  it("grades the scenarios the contract declares, not whatever is on disk", () => {
    const declared = SCENARIOS.map((s) => s.id).sort();
    const present = fs
      .readdirSync(outDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(present, "a stale or extra scenario directory means a stale run").toEqual(declared);
    expect(() => scenarioDir(declared[0])).not.toThrow();
  });
});
