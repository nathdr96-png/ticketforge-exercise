/**
 * Running the device on input it has never seen.
 *
 * Most of this suite grades files `make run` already wrote. These helpers do the
 * one thing that cannot be done that way: feed the device a transcript built
 * HERE, at grade time, so that a candidate cannot have tuned the parser to the
 * shipped corpus. Rule SCAN-R13 is the reason.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Run = { stdout: string; stderr: string; code: number | null };

/**
 * Run one segment. The sanitizer options are pinned rather than inherited: the
 * whole measurement is "stderr is empty", and a run that quietly had leak
 * detection switched off by the environment would be a green light for a leak.
 */
export function runSegment(
  bin: string,
  stateDir: string,
  transcript: string,
  queueMax = 64
): Run {
  const res = spawnSync(bin, ["--state", stateDir, "--queue-max", String(queueMax)], {
    input: transcript.endsWith("\n") ? transcript : transcript + "\n",
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      ASAN_OPTIONS: "detect_leaks=1:detect_stack_use_after_return=1",
      UBSAN_OPTIONS: "print_stacktrace=1",
      LSAN_OPTIONS: "",
    },
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status };
}

export function withTempState<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-edge-probe-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function decisionLines(stdout: string): string[] {
  return stdout.split("\n").filter((l) => l.trim() !== "");
}

export function reasonsOf(stdout: string): string[] {
  return decisionLines(stdout)
    .filter((l) => !l.startsWith("SYNC "))
    .map((l) => l.split(" ")[3]);
}
