/* The TicketForge turnstile scanner.
 *
 *   scanner --state <dir> --queue-max <n>  < transcript  > decisions
 *
 * Reads a transcript of door events on stdin, decides each admission by itself
 * because the network at a venue door cannot be relied on, and keeps everything
 * it knows in the state directory so that being power-cycled mid-event costs
 * nothing.
 *
 * The contract is contract/scanner/ — interface.yaml for the grammar and the
 * file formats, rules.yaml for the seventeen rules with their ids, README.md
 * for why each one is a rule.
 *
 * Two invariants hold everywhere in this file and are the reason it is shaped
 * the way it is:
 *
 *   1. State is persisted BEFORE the decision for it is printed (SCAN-R03).
 *      Not after, and not on the way out: ABORT below is an immediate _exit()
 *      with no flush and no handler, exactly as losing the mains would be.
 *
 *   2. Nothing is written to stderr, ever (SCAN-R14). stderr is the channel
 *      AddressSanitizer and UndefinedBehaviorSanitizer use, and the grading
 *      surface is "every segment exits 0 with an empty stderr". A device that
 *      logs there makes that measurement impossible, so diagnostics that
 *      matter go into the state directory.
 */
#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "decide.h"
#include "state.h"
#include "ticket.h"

#define DEFAULT_QUEUE_MAX 64

/* A fatal problem before the first event — a missing --state, an unwritable
 * directory. There is no decision stream yet and nothing to reconcile, so this
 * is the one place a non-zero exit is correct. It still says nothing on stderr;
 * the status is the whole message, and exit-codes.txt is where it is read. */
static int die(void)
{
    return 2;
}

/* Read one logical line, up to TF_LINE_MAX bytes. A longer line is drained to
 * the newline and reported as over-long: the device must not stop, and it must
 * not process a truncated prefix as though it were the whole line. */
static int read_line(char *buf, size_t cap, int *overlong, int *eof)
{
    size_t len = 0;
    int c;
    *overlong = 0;
    *eof = 0;
    while ((c = getchar()) != EOF) {
        if (c == '\n')
            break;
        if (c == '\r')
            continue;
        if (len + 1 < cap)
            buf[len++] = (char)c;
        else
            *overlong = 1;
    }
    buf[len] = '\0';
    if (c == EOF && len == 0 && *overlong == 0) {
        *eof = 1;
        return 0;
    }
    return 1;
}

/* Split off the first space-delimited token. Returns the rest of the line. */
static char *split_verb(char *line, char **verb)
{
    char *p = line;
    while (*p == ' ' || *p == '\t')
        p++;
    *verb = p;
    while (*p != '\0' && *p != ' ' && *p != '\t')
        p++;
    if (*p == '\0')
        return p;
    *p++ = '\0';
    while (*p == ' ' || *p == '\t')
        p++;
    return p;
}

static long long parse_ll(const char *s, int *ok)
{
    char *end = NULL;
    long long v = strtoll(s, &end, 10);
    *ok = (end != s && end != NULL && *end == '\0');
    return v;
}

/* One decision line, then flush. The operator watching the door log sees the
 * answer the instant it is made, and a power cut cannot swallow a decision the
 * device has already committed to. */
static void emit_scan(unsigned long long seq, const char *ticket_id, int admitted,
                      tf_reason reason)
{
    printf("%llu %s %s %s\n", seq, ticket_id, admitted ? "ADMIT" : "REFUSE",
           tf_reason_name(reason));
    fflush(stdout);
}

static void emit_sync(size_t uploaded, size_t depth)
{
    printf("SYNC %zu %zu\n", uploaded, depth);
    fflush(stdout);
}

static void handle_scan(tf_state *st, const char *blob)
{
    tf_ticket ticket;
    int parsed = 0;
    tf_reason reason = tf_decide(st, blob, &ticket, &parsed);
    int admitted = (reason == TF_OK);
    long long now = tf_trusted_now(st);

    unsigned long long seq = st->next_seq++;
    st->scans_total++;
    if (admitted) {
        st->admitted_total++;
        (void)tf_admitted_insert(st, ticket.ticket_id, now, 0);
    } else {
        st->refused_total++;
        st->refused_by_reason[reason]++;
    }

    /* Every scan is queued, refusals included: a ticket presented twice is
     * exactly what the back office wants to see (SCAN-R16). */
    tf_record rec;
    memset(&rec, 0, sizeof(rec));
    rec.record_id = st->next_record_id++;
    snprintf(rec.ticket_id, sizeof(rec.ticket_id), "%s", parsed ? ticket.ticket_id : "-");
    rec.scanned_at = now;
    rec.admitted = admitted;
    rec.reason = reason;
    tf_queue_push(st, &rec);
    st->queued_total++;

    (void)tf_state_persist(st);
    emit_scan(seq, parsed ? ticket.ticket_id : "-", admitted, reason);
}

static void handle_sync(tf_state *st)
{
    size_t sent = tf_queue_upload(st);
    (void)tf_state_persist(st);
    emit_sync(sent, st->queue_len);
}

static void handle_replay(tf_state *st, char *args)
{
    char *id = NULL;
    char *rest = split_verb(args, &id);
    int ok = 0;
    long long at = parse_ll(rest, &ok);

    st->replay_total++;
    /* A replayed record is upstream telling us something it already knows. It
     * is never new work: it does not queue, it does not move admitted_total
     * (which counts people THIS door let in), and it never removes anything
     * from the admitted set. Absorbing one we have not seen is what makes a
     * two-gate venue safe — the far door admitted them, so this one must
     * refuse them (SCAN-R06). */
    if (ok && id[0] != '\0' && strlen(id) <= TF_TICKET_ID_MAX) {
        if (tf_admitted_insert(st, id, at, 1))
            st->replay_absorbed_total++;
    }
    (void)tf_state_persist(st);
}

int main(int argc, char **argv)
{
    const char *dir = NULL;
    size_t queue_max = DEFAULT_QUEUE_MAX;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--state") == 0 && i + 1 < argc) {
            dir = argv[++i];
        } else if (strcmp(argv[i], "--queue-max") == 0 && i + 1 < argc) {
            int ok = 0;
            long long v = parse_ll(argv[++i], &ok);
            if (!ok || v < 1 || v > 1000000)
                return die();
            queue_max = (size_t)v;
        } else {
            return die();
        }
    }
    if (dir == NULL)
        return die();

    tf_state st;
    const char *err = NULL;
    if (tf_state_open(&st, dir, queue_max, &err) != 0)
        return die();

    char line[TF_LINE_MAX + 1];
    for (;;) {
        int overlong = 0;
        int eof = 0;
        if (!read_line(line, sizeof(line), &overlong, &eof))
            break;
        if (eof)
            break;
        if (overlong) {
            /* Longer than the declared maximum: not a line this device will
             * act on, counted so it is visible, and survived. */
            st.unknown_event_total++;
            (void)tf_state_persist(&st);
            continue;
        }
        char *verb = NULL;
        char *args = split_verb(line, &verb);
        if (verb[0] == '\0' || verb[0] == '#')
            continue;

        if (strcmp(verb, "SCAN") == 0) {
            handle_scan(&st, args);
        } else if (strcmp(verb, "SYNC") == 0) {
            handle_sync(&st);
        } else if (strcmp(verb, "REPLAY") == 0) {
            handle_replay(&st, args);
        } else if (strcmp(verb, "GATE") == 0) {
            if (args[0] != '\0' && strlen(args) <= TF_EVENT_ID_MAX) {
                snprintf(st.gate_event_id, sizeof(st.gate_event_id), "%s", args);
                (void)tf_state_persist(&st);
            } else {
                st.unknown_event_total++;
                (void)tf_state_persist(&st);
            }
        } else if (strcmp(verb, "LINK") == 0) {
            if (strcmp(args, "up") == 0 || strcmp(args, "down") == 0) {
                st.link_up = (strcmp(args, "up") == 0);
                (void)tf_state_persist(&st);
            } else {
                st.unknown_event_total++;
                (void)tf_state_persist(&st);
            }
        } else if (strcmp(verb, "TICK") == 0) {
            int ok = 0;
            long long secs = parse_ll(args, &ok);
            if (ok && secs >= 0) {
                /* Elapsed time: the monotonic clock and the wall clock both
                 * move by it. */
                st.mono += secs;
                st.wall += secs;
                (void)tf_state_persist(&st);
            } else {
                st.unknown_event_total++;
                (void)tf_state_persist(&st);
            }
        } else if (strcmp(verb, "NOW") == 0) {
            int ok = 0;
            long long t = parse_ll(args, &ok);
            if (ok) {
                /* A clock jump: the device's wall clock is set. */
                st.wall = t;
                (void)tf_state_persist(&st);
            } else {
                st.unknown_event_total++;
                (void)tf_state_persist(&st);
            }
        } else if (strcmp(verb, "TIME") == 0) {
            int ok = 0;
            long long t = parse_ll(args, &ok);
            if (!ok || t < 0) {
                st.unknown_event_total++;
            } else if (!st.link_up) {
                /* Authoritative time has to come over the link. A value that
                 * arrives with the link down did not come from upstream. */
                st.time_rejected_total++;
            } else {
                st.trusted_epoch = t;
                st.trusted_anchor_mono = st.mono;
                st.has_trusted = 1;
            }
            (void)tf_state_persist(&st);
        } else if (strcmp(verb, "ABORT") == 0) {
            /* The mains go. Everything already announced on stdout is already
             * on the flash, so there is nothing to do here but stop — and
             * stopping has to be _exit(), not exit(): no stdio flush, no
             * atexit handler, no destructor. A device that only gets its state
             * right because of the code that runs on the way out has not got
             * it right (SCAN-R03). */
            _exit(0);
        } else {
            /* A verb this device has never heard of. One day a newer server
             * will send it one and the door must keep working. */
            st.unknown_event_total++;
            (void)tf_state_persist(&st);
        }
    }

    (void)tf_state_persist(&st);
    tf_state_free(&st);
    return 0;
}
