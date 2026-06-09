/**
 * Shared reading of the contract and of a device's output directory.
 *
 * Nothing here looks at an implementation. The edge family's grading surface is
 * the bytes a device wrote — its decision stream, its state files and its exit
 * status — so every helper below takes a directory and returns data.
 */
import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
export const CONTRACT_DIR = path.join(REPO_ROOT, "contract", "scanner");
export const EXPECTED_DIR = path.join(import.meta.dirname, "expected");

export type Scenario = {
  id: string;
  queueMax: number;
  segments: number;
  seeded: boolean;
  title: string;
};

/**
 * The directory the device under test wrote to. No default, in the runner or
 * here: silently grading the wrong directory is worse than refusing to run, and
 * the failure mode it prevents — a green run against last week's output — is
 * the one nobody notices.
 */
export function outDir(): string {
  const raw = process.env.SCAN_OUT_DIR;
  if (!raw || raw.trim() === "") {
    throw new Error(
      "SCAN_OUT_DIR is not set — these tests grade the output directory a scanner wrote"
    );
  }
  return path.resolve(raw);
}

/** The device binary, when the recipe gave us one. Some checks need to run it. */
export function scannerBin(): string | null {
  const raw = process.env.SCANNER_BIN;
  if (!raw || raw.trim() === "") return null;
  const resolved = path.resolve(raw);
  return fs.existsSync(resolved) ? resolved : null;
}

export function loadScenarios(): Scenario[] {
  const file = path.join(CONTRACT_DIR, "scenarios", "index.tsv");
  const out: Scenario[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [id, queueMax, segments, seeded, ...title] = line.split("\t");
    out.push({
      id,
      queueMax: Number(queueMax),
      segments: Number(segments),
      seeded: seeded === "yes",
      title: title.join("\t"),
    });
  }
  if (out.length === 0) throw new Error(`no scenarios declared in ${file}`);
  return out;
}

export function scenarioDir(id: string): string {
  const dir = path.join(outDir(), id);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `no output for scenario ${id}: expected ${dir}\n` +
        "run `make run` in the slot (it writes every declared scenario)"
    );
  }
  return dir;
}

export function readText(...parts: string[]): string {
  const file = path.join(...parts);
  if (!fs.existsSync(file)) throw new Error(`missing output file: ${file}`);
  return fs.readFileSync(file, "utf8");
}

export function lines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim() !== "");
}

export function decisions(id: string): string[] {
  return lines(readText(scenarioDir(id), "decisions.txt"));
}

export function expectedDecisions(id: string): string[] {
  const file = path.join(EXPECTED_DIR, id, "decisions.txt");
  if (!fs.existsSync(file)) {
    throw new Error(
      `no expected decisions for ${id}: ${file}\n` +
        "the expected decision streams in ./expected/ are generated, not hand-written"
    );
  }
  return lines(fs.readFileSync(file, "utf8"));
}

/** Only the SCAN decisions, with the SYNC lines dropped. */
export function scans(decisionLines: string[]): ScanLine[] {
  return decisionLines
    .filter((l) => !l.startsWith("SYNC "))
    .map((l, i) => {
      const parts = l.split(" ");
      if (parts.length !== 4) {
        throw new Error(`decision line ${i + 1} is not "<seq> <id> <verdict> <reason>": ${l}`);
      }
      return { seq: BigInt(parts[0]), ticketId: parts[1], verdict: parts[2], reason: parts[3] };
    });
}

export type ScanLine = { seq: bigint; ticketId: string; verdict: string; reason: string };

export function syncs(decisionLines: string[]): { uploaded: number; depth: number }[] {
  return decisionLines
    .filter((l) => l.startsWith("SYNC "))
    .map((l) => {
      const parts = l.split(" ");
      if (parts.length !== 3) throw new Error(`sync line is not "SYNC <n> <depth>": ${l}`);
      return { uploaded: Number(parts[1]), depth: Number(parts[2]) };
    });
}

export type Counters = Record<string, unknown>;

export function counters(id: string, sub = "state"): Counters {
  const raw = readText(scenarioDir(id), sub, "counters.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${id}/${sub}/counters.json is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${id}/${sub}/counters.json must be a JSON object`);
  }
  return parsed as Counters;
}

/**
 * The counters a scenario STARTED from. s09-counter-bounds hands the device a
 * state directory that has already seen four billion scans, so every accounting
 * law in this suite is a law about the DELTA across the run rather than about
 * the absolute values — otherwise the seeded scenario would have to be exempted
 * from all of them, which is exactly the scenario you least want exempted.
 */
export function initialCounters(scenario: Scenario): Counters {
  if (!scenario.seeded) return {};
  const file = path.join(
    CONTRACT_DIR,
    "scenarios",
    scenario.id,
    "initial-state",
    "counters.json"
  );
  return JSON.parse(fs.readFileSync(file, "utf8")) as Counters;
}

/** Exact integers. There is no tolerance: a counter is a count. */
export function int(c: Counters, key: string): bigint {
  const v = c[key];
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`${key} is not an integer: ${v}`);
    if (!Number.isSafeInteger(v)) {
      throw new Error(
        `${key} is ${v}, outside the exact integer range — the contract's bound is 2^53-1`
      );
    }
    return BigInt(v);
  }
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  throw new Error(`counters.json has no integer ${key} (got ${JSON.stringify(v)})`);
}

export function intOr(c: Counters, key: string, fallback: bigint): bigint {
  return key in c ? int(c, key) : fallback;
}

/** `final - initial` for a counter, so a seeded device obeys the same laws. */
export function delta(final: Counters, initial: Counters, key: string): bigint {
  return int(final, key) - intOr(initial, key, 0n);
}

export type QueueRecord = {
  recordId: bigint;
  ticketId: string;
  scannedAt: bigint;
  verdict: string;
  reason: string;
};

export function records(text: string): QueueRecord[] {
  return lines(text).map((l) => {
    const parts = l.split(" ");
    if (parts.length !== 5) {
      throw new Error(
        `queue/uploaded line is not "<record_id> <ticket_id> <scanned_at> <verdict> <reason>": ${l}`
      );
    }
    return {
      recordId: BigInt(parts[0]),
      ticketId: parts[1],
      scannedAt: BigInt(parts[2]),
      verdict: parts[3],
      reason: parts[4],
    };
  });
}

export function uploaded(id: string, sub = "state"): QueueRecord[] {
  const file = path.join(scenarioDir(id), sub, "uploaded.log");
  return fs.existsSync(file) ? records(fs.readFileSync(file, "utf8")) : [];
}

export function queued(id: string, sub = "state"): QueueRecord[] {
  const file = path.join(scenarioDir(id), sub, "queue.log");
  return fs.existsSync(file) ? records(fs.readFileSync(file, "utf8")) : [];
}

export type AdmitEntry = { ticketId: string; admittedAt: bigint; source: string };

export function admitted(id: string, sub = "state"): AdmitEntry[] {
  const file = path.join(scenarioDir(id), sub, "admitted.log");
  if (!fs.existsSync(file)) return [];
  return lines(fs.readFileSync(file, "utf8")).map((l) => {
    const parts = l.split(" ");
    if (parts.length !== 3) {
      throw new Error(`admitted.log line is not "<ticket_id> <admitted_at> <source>": ${l}`);
    }
    return { ticketId: parts[0], admittedAt: BigInt(parts[1]), source: parts[2] };
  });
}

export function exitCodes(id: string): { segment: string; code: number }[] {
  return lines(readText(scenarioDir(id), "exit-codes.txt")).map((l) => {
    const [segment, code] = l.split(" ");
    return { segment, code: Number(code) };
  });
}

export function stderrOf(id: string): string {
  return readText(scenarioDir(id), "stderr.log");
}

export function deviceInfo(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(readText(outDir(), "device.txt"))) {
    const sp = line.indexOf(" ");
    if (sp > 0) out[line.slice(0, sp)] = line.slice(sp + 1);
  }
  return out;
}

/** Keyed FNV-1a-64, per contract/scanner/interface.yaml. Used to forge the
 * suite's own hostile blobs, so the probe transcripts are built here rather than
 * read from a fixture the candidate has seen. */
export function sign(
  ticketId: string,
  eventId: string,
  seatId: string,
  validFrom: number,
  validTo: number
): string {
  const payload = `tf-scanner-v1|${ticketId}|${eventId}|${seatId}|${validFrom}|${validTo}`;
  let h = 0xcbf29ce484222325n;
  const mask = (1n << 64n) - 1n;
  for (const byte of Buffer.from(payload, "ascii")) {
    h = (h ^ BigInt(byte)) & mask;
    h = (h * 0x100000001b3n) & mask;
  }
  return h.toString(16).padStart(16, "0");
}

export function blob(
  ticketId: string,
  eventId: string,
  seatId: string,
  validFrom: number,
  validTo: number
): string {
  return [
    ticketId,
    eventId,
    seatId,
    validFrom,
    validTo,
    sign(ticketId, eventId, seatId, validFrom, validTo),
  ].join("|");
}
