/* The scanner's own unit tests — `make test`.
 *
 * These are the slot's tests, not the grading suite. conformance/edge grades
 * the bytes the device writes; this file tests the three pieces underneath
 * directly, including the ones whose behaviour is hard to reach from a
 * transcript: the parser's length checks, the queue's eviction at the bound,
 * and the counter arithmetic across 2^32.
 *
 * Built and run with the same sanitizers as the device itself, so a parser bug
 * that happens not to break a decision still fails here.
 */
#define _POSIX_C_SOURCE 200809L

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "decide.h"
#include "state.h"
#include "ticket.h"

static int failures = 0;
static int checks = 0;

#define CHECK(cond, what)                                                        \
    do {                                                                         \
        checks++;                                                                \
        if (!(cond)) {                                                           \
            failures++;                                                          \
            printf("  FAIL %s (%s:%d)\n", (what), __FILE__, __LINE__);           \
        }                                                                        \
    } while (0)

#define CHECK_EQ_LL(got, want, what)                                             \
    do {                                                                         \
        checks++;                                                                \
        long long g_ = (long long)(got);                                         \
        long long w_ = (long long)(want);                                        \
        if (g_ != w_) {                                                          \
            failures++;                                                          \
            printf("  FAIL %s: got %lld want %lld (%s:%d)\n", (what), g_, w_,    \
                   __FILE__, __LINE__);                                          \
        }                                                                        \
    } while (0)

#define CHECK_EQ_ULL(got, want, what)                                            \
    do {                                                                         \
        checks++;                                                                \
        unsigned long long g_ = (unsigned long long)(got);                       \
        unsigned long long w_ = (unsigned long long)(want);                      \
        if (g_ != w_) {                                                          \
            failures++;                                                          \
            printf("  FAIL %s: got %llu want %llu (%s:%d)\n", (what), g_, w_,    \
                   __FILE__, __LINE__);                                          \
        }                                                                        \
    } while (0)

/* ---------------------------------------------------------------- fixtures */

/* tkt_arena_A01-01, straight out of contract/scanner/tickets.jsonl. The window
 * is derived from event_arena_2000's starts_at in contract/seed/seed.json. */
#define ARENA_FROM 1788282000LL
#define ARENA_TO 1788300000LL
#define AT_DOOR 1788285600LL

static void signed_blob(char *out, size_t cap, const char *tid, const char *eid,
                        const char *sid, long long from, long long to)
{
    /* TODO(FEAT-1112): tickets cannot be signed yet, so these blobs carry a
     * placeholder signature that only has the right shape. */
    snprintf(out, cap, "%s|%s|%s|%lld|%lld|%s", tid, eid, sid, from, to,
             "0000000000000000");
}

static void arena_blob(char *out, size_t cap, int seat)
{
    char tid[TF_TICKET_ID_MAX + 1];
    char sid[TF_SEAT_ID_MAX + 1];
    snprintf(tid, sizeof(tid), "tkt_arena_A01-%02d", seat);
    snprintf(sid, sizeof(sid), "seat_arena_A01-%02d", seat);
    signed_blob(out, cap, tid, "event_arena_2000", sid, ARENA_FROM, ARENA_TO);
}

static char tmpdir_buf[256];

static const char *fresh_dir(const char *name)
{
    snprintf(tmpdir_buf, sizeof(tmpdir_buf), "build/t-%s-%d", name, (int)getpid());
    char cmd[512];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", tmpdir_buf);
    if (system(cmd) != 0)
        printf("  (could not clear %s)\n", tmpdir_buf);
    return tmpdir_buf;
}

static void drop_dir(const char *dir)
{
    char cmd[512];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", dir);
    if (system(cmd) != 0)
        printf("  (could not remove %s)\n", dir);
}

static void commission(tf_state *st)
{
    snprintf(st->gate_event_id, sizeof(st->gate_event_id), "%s", "event_arena_2000");
    st->link_up = 1;
    st->has_trusted = 1;
    st->trusted_epoch = AT_DOOR;
    st->trusted_anchor_mono = 0;
    st->mono = 0;
    st->wall = AT_DOOR;
}

/* -------------------------------------------------------------- the ticket */

static void test_parser_rejects(void)
{
    printf("parser\n");
    tf_ticket t;
    CHECK(tf_parse_blob("", &t) != 0, "empty blob");
    CHECK(tf_parse_blob("a|b|c", &t) != 0, "three fields");
    CHECK(tf_parse_blob("a|b|c|1|2|3|4", &t) != 0, "seven fields");
    CHECK(tf_parse_blob("a|b|c|1|2|", &t) != 0, "empty signature field");
    CHECK(tf_parse_blob("a|b|c||2|0123456789abcdef", &t) != 0, "empty valid_from");
    CHECK(tf_parse_blob("a|b|c|x|2|0123456789abcdef", &t) != 0, "non-numeric valid_from");
    CHECK(tf_parse_blob("a|b|c|-1|2|0123456789abcdef", &t) != 0, "negative valid_from");
    CHECK(tf_parse_blob("a|b|c|5|2|0123456789abcdef", &t) != 0, "window inverted");
    CHECK(tf_parse_blob("a|b|c|1|2|0123456789ABCDEF", &t) != 0, "signature not lower hex");
    CHECK(tf_parse_blob("a|b|c|1|2|0123456789abcde", &t) != 0, "signature too short");

    /* Rule SCAN-R13. The length is checked before anything is copied, so this
     * is a refusal and not a 310-byte write into a 65-byte field. Run under
     * AddressSanitizer, which is how we know. */
    char over[TF_BLOB_MAX + 512];
    char long_id[320];
    memset(long_id, 'X', sizeof(long_id) - 1);
    long_id[sizeof(long_id) - 1] = '\0';
    signed_blob(over, sizeof(over), long_id, "event_arena_2000", "seat_arena_A01-01",
                ARENA_FROM, ARENA_TO);
    CHECK(tf_parse_blob(over, &t) != 0, "a 319-byte ticket id is refused, not copied");

    char long_event[64];
    memset(long_event, 'E', sizeof(long_event) - 1);
    long_event[sizeof(long_event) - 1] = '\0';
    signed_blob(over, sizeof(over), "tkt_arena_A01-01", long_event, "seat_arena_A01-01",
                ARENA_FROM, ARENA_TO);
    CHECK(tf_parse_blob(over, &t) != 0, "a 63-byte event id is refused");

    char huge[1000];
    memset(huge, 'Z', sizeof(huge) - 1);
    huge[sizeof(huge) - 1] = '\0';
    CHECK(tf_parse_blob(huge, &t) != 0, "a 999-byte blob with no separators is refused");
}

/* ------------------------------------------------------------- the decision */

static void test_precedence(void)
{
    printf("decision precedence\n");
    const char *err = NULL;
    const char *dir = fresh_dir("prec");
    tf_state st;
    CHECK_EQ_LL(tf_state_open(&st, dir, 64, &err), 0, "state opens");

    char blob[TF_BLOB_MAX + 8];
    tf_ticket t;
    int parsed = 0;

    arena_blob(blob, sizeof(blob), 1);
    CHECK_EQ_LL(tf_decide(&st, blob, &t, &parsed), TF_NOT_COMMISSIONED,
                "uncommissioned gate refuses");
    commission(&st);
    CHECK_EQ_LL(tf_decide(&st, blob, &t, &parsed), TF_OK, "a valid ticket is admitted");

    /* Malformed wins over a bad signature: the length check comes first. */
    char long_id[320];
    memset(long_id, 'X', sizeof(long_id) - 1);
    long_id[sizeof(long_id) - 1] = '\0';
    char over[TF_BLOB_MAX + 512];
    signed_blob(over, sizeof(over), long_id, "event_arena_2000", "seat_arena_A01-01",
                ARENA_FROM, ARENA_TO);
    CHECK_EQ_LL(tf_decide(&st, over, &t, &parsed), TF_MALFORMED, "over-long id is MALFORMED");
    CHECK_EQ_LL(parsed, 0, "an unparsed blob reports no ticket id");

    char jazz[TF_BLOB_MAX + 8];
    signed_blob(jazz, sizeof(jazz), "tkt_jazz_A01-01", "event_jazz_eur",
                "seat_jazz_A01-01", ARENA_FROM, ARENA_TO);
    CHECK_EQ_LL(tf_decide(&st, jazz, &t, &parsed), TF_WRONG_EVENT,
                "a foreign ticket is WRONG_EVENT");

    /* DUPLICATE wins over EXPIRED. "Already used" does not depend on the clock. */
    arena_blob(blob, sizeof(blob), 1);
    CHECK_EQ_LL(tf_admitted_insert(&st, "tkt_arena_A01-01", AT_DOOR, 0), 1, "first insert is new");
    st.mono += 100000; /* long past valid_to */
    CHECK_EQ_LL(tf_decide(&st, blob, &t, &parsed), TF_DUPLICATE,
                "an admitted ticket is DUPLICATE even once expired");

    arena_blob(blob, sizeof(blob), 2);
    CHECK_EQ_LL(tf_decide(&st, blob, &t, &parsed), TF_EXPIRED, "past the window is EXPIRED");
    st.mono = 0;
    st.trusted_epoch = ARENA_FROM - 100;
    CHECK_EQ_LL(tf_decide(&st, blob, &t, &parsed), TF_NOT_YET_VALID,
                "before the window is NOT_YET_VALID");

    st.has_trusted = 0;
    CHECK_EQ_LL(tf_decide(&st, blob, &t, &parsed), TF_NO_TRUSTED_TIME,
                "with no trusted time, nothing is admitted");

    tf_state_free(&st);
    drop_dir(dir);
}

static void test_trusted_clock(void)
{
    printf("trusted clock\n");
    const char *err = NULL;
    const char *dir = fresh_dir("clock");
    tf_state st;
    CHECK_EQ_LL(tf_state_open(&st, dir, 64, &err), 0, "state opens");
    commission(&st);

    CHECK_EQ_LL(tf_trusted_now(&st), AT_DOOR, "trusted now is the anchor at mono 0");
    st.wall = 1893456000LL; /* the coin cell dies and the clock reads 2030 */
    CHECK_EQ_LL(tf_trusted_now(&st), AT_DOOR, "a wall-clock jump does not move trusted time");
    st.wall = 0;
    CHECK_EQ_LL(tf_trusted_now(&st), AT_DOOR, "nor does a jump to 1970");
    st.mono += 3600;
    CHECK_EQ_LL(tf_trusted_now(&st), AT_DOOR + 3600, "monotonic elapsed time does move it");
    st.has_trusted = 0;
    CHECK_EQ_LL(tf_trusted_now(&st), -1, "an uncommissioned clock has no trusted time");

    tf_state_free(&st);
    drop_dir(dir);
}

/* ----------------------------------------------------------------- the state */

static tf_record scan_record(unsigned long long id, const char *ticket_id)
{
    tf_record rec;
    memset(&rec, 0, sizeof(rec));
    rec.record_id = id;
    snprintf(rec.ticket_id, sizeof(rec.ticket_id), "%s", ticket_id);
    rec.scanned_at = AT_DOOR;
    rec.admitted = 1;
    rec.reason = TF_OK;
    return rec;
}

static void test_queue_bound(void)
{
    printf("queue bound\n");
    const char *err = NULL;
    const char *dir = fresh_dir("queue");
    tf_state st;
    CHECK_EQ_LL(tf_state_open(&st, dir, 4, &err), 0, "state opens with queue_max 4");
    st.link_up = 0;

    for (unsigned long long i = 1; i <= 10; i++) {
        char id[32];
        snprintf(id, sizeof(id), "tkt_%llu", i);
        tf_record rec = scan_record(i, id);
        tf_queue_push(&st, &rec);
        st.queued_total++;
    }
    CHECK_EQ_ULL(st.queue_len, 4u, "the queue is bounded at 4");
    CHECK_EQ_ULL(st.queue_evicted_total, 6u, "six evictions were counted, not silent");
    CHECK_EQ_ULL(st.queue[st.queue_head].record_id, 7u, "the OLDEST survivor is record 7");

    /* Offline sync uploads nothing and leaves the queue alone. */
    CHECK_EQ_ULL(tf_queue_upload(&st), 0u, "an offline sync uploads nothing");
    CHECK_EQ_ULL(st.queue_len, 4u, "an offline sync leaves the queue intact");
    CHECK_EQ_ULL(st.sync_offline_total, 1u, "an offline sync is counted");

    st.link_up = 1;
    CHECK_EQ_ULL(tf_queue_upload(&st), 4u, "an online sync uploads the whole queue");
    CHECK_EQ_ULL(st.queue_len, 0u, "and empties it");
    CHECK_EQ_ULL(tf_queue_upload(&st), 0u, "a second sync uploads nothing");
    CHECK_EQ_ULL(st.pending_upload_len, 4u, "four records are waiting for uploaded.log");
    CHECK_EQ_ULL(st.pending_upload[0].record_id, 7u, "uploaded in FIFO order");
    CHECK_EQ_ULL(st.pending_upload[3].record_id, 10u, "oldest first, newest last");

    /* The conservation law of rule SCAN-R08, on the structure itself. */
    CHECK_EQ_ULL(st.queued_total, st.uploaded_total + st.queue_len + st.queue_evicted_total,
                 "queued == uploaded + depth + evicted");

    CHECK_EQ_LL(tf_state_persist(&st), 0, "persist succeeds");
    tf_state_free(&st);
    drop_dir(dir);
}

static void test_persistence(void)
{
    printf("persistence across a reopen\n");
    const char *err = NULL;
    const char *dir = fresh_dir("persist");

    tf_state st;
    CHECK_EQ_LL(tf_state_open(&st, dir, 8, &err), 0, "state opens");
    commission(&st);
    st.next_seq = 41;
    st.next_record_id = 91;
    CHECK_EQ_LL(tf_admitted_insert(&st, "tkt_arena_A01-01", AT_DOOR, 0), 1, "insert is new");
    CHECK_EQ_LL(tf_admitted_insert(&st, "tkt_arena_A01-01", AT_DOOR, 0), 0,
                "re-inserting the same ticket changes nothing");
    CHECK_EQ_LL(tf_admitted_insert(&st, "tkt_arena_B05-07", AT_DOOR - 100, 1), 1,
                "a replay from the other gate is absorbed");
    tf_record rec = scan_record(91, "tkt_arena_A01-02");
    tf_queue_push(&st, &rec);
    st.queued_total++;
    CHECK_EQ_LL(tf_state_persist(&st), 0, "persist succeeds");
    tf_state_free(&st);

    /* A new process against the same flash: rule SCAN-R02. */
    tf_state re;
    CHECK_EQ_LL(tf_state_open(&re, dir, 8, &err), 0, "state reopens");
    CHECK(strcmp(re.gate_event_id, "event_arena_2000") == 0, "the gate is remembered");
    CHECK_EQ_LL(re.link_up, 1, "the link state is remembered");
    CHECK_EQ_LL(re.has_trusted, 1, "the trusted-time anchor is remembered");
    CHECK_EQ_LL(tf_trusted_now(&re), AT_DOOR, "and still reads the same");
    CHECK_EQ_ULL(re.next_seq, 41u, "the sequence number is remembered");
    CHECK_EQ_ULL(re.next_record_id, 91u, "the record id is remembered");
    CHECK_EQ_LL(tf_admitted_contains(&re, "tkt_arena_A01-01"), 1, "the local admission survived");
    CHECK_EQ_LL(tf_admitted_contains(&re, "tkt_arena_B05-07"), 1, "the absorbed replay survived");
    CHECK_EQ_LL(tf_admitted_contains(&re, "tkt_arena_A01-09"), 0, "and nothing else did");
    CHECK_EQ_ULL(re.admitted_count, 2u, "the admitted set has two entries");
    CHECK_EQ_ULL(re.queue_len, 1u, "the offline queue survived");
    CHECK_EQ_ULL(re.queue[re.queue_head].record_id, 91u, "with its record id intact");
    tf_state_free(&re);
    drop_dir(dir);
}

static void test_counter_bounds(void)
{
    printf("counter bounds\n");
    const char *err = NULL;
    const char *dir = fresh_dir("counters");

    tf_state st;
    CHECK_EQ_LL(tf_state_open(&st, dir, 8, &err), 0, "state opens");
    commission(&st);
    st.next_seq = 4294967295ULL;        /* 2^32 - 1 */
    st.next_record_id = 281474976710655ULL; /* 2^48 - 1 */
    st.scans_total = 4294967295ULL;
    unsigned long long seq_a = st.next_seq++;
    unsigned long long seq_b = st.next_seq++;
    CHECK_EQ_ULL(seq_a, 4294967295ULL, "the last 32-bit sequence number");
    CHECK_EQ_ULL(seq_b, 4294967296ULL, "and the first one past it, not zero");
    st.scans_total += 2;
    CHECK_EQ_ULL(st.scans_total, 4294967297ULL, "scans_total crosses 2^32 exactly");
    CHECK_EQ_LL(tf_state_persist(&st), 0, "persist succeeds at the boundary");
    tf_state_free(&st);

    tf_state re;
    CHECK_EQ_LL(tf_state_open(&re, dir, 8, &err), 0, "state reopens");
    CHECK_EQ_ULL(re.next_seq, 4294967297ULL, "next_seq survives the round trip");
    CHECK_EQ_ULL(re.scans_total, 4294967297ULL, "scans_total survives the round trip");
    CHECK_EQ_ULL(re.next_record_id, 281474976710655ULL, "a 2^48 record id survives it too");
    tf_state_free(&re);
    drop_dir(dir);
}

static void test_admitted_set_grows(void)
{
    printf("admitted set\n");
    const char *err = NULL;
    const char *dir = fresh_dir("grow");
    tf_state st;
    CHECK_EQ_LL(tf_state_open(&st, dir, 8, &err), 0, "state opens");

    /* Past the initial table capacity several times over, so the rehash path is
     * exercised rather than assumed. Under AddressSanitizer this is also the
     * test that would catch a use-after-free of the old table. */
    for (int i = 0; i < 500; i++) {
        char id[TF_TICKET_ID_MAX + 1];
        snprintf(id, sizeof(id), "tkt_arena_X%03d-01", i);
        CHECK_EQ_LL(tf_admitted_insert(&st, id, AT_DOOR, 0), 1, "each ticket is new");
    }
    CHECK_EQ_ULL(st.admitted_count, 500u, "all 500 are in the set");
    for (int i = 0; i < 500; i++) {
        char id[TF_TICKET_ID_MAX + 1];
        snprintf(id, sizeof(id), "tkt_arena_X%03d-01", i);
        CHECK_EQ_LL(tf_admitted_contains(&st, id), 1, "and all 500 are still found");
    }
    CHECK_EQ_LL(tf_admitted_contains(&st, "tkt_arena_X500-01"), 0, "501st is not");
    tf_state_free(&st);
    drop_dir(dir);
}

int main(void)
{
    test_parser_rejects();
    test_precedence();
    test_trusted_clock();
    test_queue_bound();
    test_persistence();
    test_counter_bounds();
    test_admitted_set_grows();

    printf("\n%d checks, %d failure(s)\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
