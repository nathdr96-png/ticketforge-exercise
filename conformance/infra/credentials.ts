/**
 * The credential scan behind DEP-017.
 *
 * Deliberately narrow. A grep for the word "secret" finds `secretKeyRef`,
 * `secretName: ticketforge-tls` and the policy file's own prose, so a scanner
 * built that way gets muted within a week and then finds nothing at all. Every
 * pattern here matches a credential's *shape*, not a word near it:
 *
 *  - a URI with a password in its authority (`postgres://user:pw@host/db`)
 *  - a key whose name can only be a password, assigned a literal
 *  - the recognisable prefixes of real credentials (AWS, GitHub, Stripe, Slack)
 *  - a PEM private key block
 *
 * A value that is obviously a reference — `${...}`, `{{ ... }}`, `$VAR`, an
 * empty string — is never a finding, because that is what correct configuration
 * looks like.
 */

export interface Finding {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

const REFERENCE = /^(?:""|''|\$\{|\$\(|\{\{|\$[A-Za-z_]|<|%\{)/;

/** Mask the middle of a match: a failure message must not reprint the secret. */
function redact(text: string): string {
  const trimmed = text.trim().slice(0, 160);
  return trimmed.replace(/([^\s:@/=]{2})[^\s:@/=]{3,}([^\s:@/=]{2})/g, (_m, a, b) => `${a}***${b}`);
}

const PATTERNS: { rule: string; re: RegExp }[] = [
  {
    // scheme://user:password@host — the single most common way a connection
    // string with a credential in it reaches a repository.
    rule: "password in a URI",
    re: /\b[a-z][a-z0-9+.\-]*:\/\/[^\s/@"'`]+:[^\s/@"'`]+@[^\s"'`]+/,
  },
  {
    rule: "password assigned a literal",
    re: /\b(?:password|passwd|pgpassword|postgres_password|mysql_password|db_password|redis_password)\s*[:=]\s*(?!\s*$)(["']?)([^\s"',}]+)\1/i,
  },
  { rule: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { rule: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{10,}\b/ },
  { rule: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: "private key block", re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
];

export function scanForCredentials(files: { path: string; text: string }[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const lines = file.text.split("\n");
    lines.forEach((line, i) => {
      for (const { rule, re } of PATTERNS) {
        const m = re.exec(line);
        if (!m) continue;
        // The captured value, where the pattern has one, decides whether this is
        // a literal or a reference.
        const captured = m[2] ?? m[0];
        if (REFERENCE.test(captured.trim())) continue;
        findings.push({ file: file.path, line: i + 1, rule, excerpt: redact(line) });
        break;
      }
    });
  }
  return findings;
}
