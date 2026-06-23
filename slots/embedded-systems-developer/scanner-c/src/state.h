/* The device's flash.
 *
 * Everything the scanner knows lives in one state directory and is written
 * there BEFORE the decision that produced it is announced on stdout
 * (rule SCAN-R03). Nothing is kept only in memory, because the thing this
 * device is for is being power-cycled at a turnstile.
 *
 * File formats: contract/scanner/interface.yaml, `state_dir`.
 */
#ifndef TF_STATE_H
#define TF_STATE_H

#include <stddef.h>

#include "ticket.h"

/* Declared in precedence order, which is also the order refused_by_reason is
 * written in. Do not reorder without changing contract/scanner/interface.yaml. */
typedef enum {
    TF_MALFORMED = 0,
    TF_BAD_SIGNATURE,
    TF_NOT_COMMISSIONED,
    TF_WRONG_EVENT,
    TF_DUPLICATE,
    TF_NO_TRUSTED_TIME,
    TF_NOT_YET_VALID,
    TF_EXPIRED,
    TF_OK,
    TF_REASON_COUNT
} tf_reason;

const char *tf_reason_name(tf_reason r);

#define TF_REASON_NAME_MAX 20

typedef struct {
    unsigned long long record_id;
    char ticket_id[TF_TICKET_ID_MAX + 1]; /* "-" when the blob never parsed */
    long long scanned_at;                 /* trusted time, or -1 if there is none */
    int admitted;
    tf_reason reason;
} tf_record;

typedef struct {
    char ticket_id[TF_TICKET_ID_MAX + 1]; /* "" marks an empty slot */
    long long admitted_at;
    int from_replay;
} tf_admit;

typedef struct {
    char dir[4000];
    size_t queue_max;

    /* ---- persisted scalars ---- */
    char gate_event_id[TF_EVENT_ID_MAX + 1]; /* "" until GATE commissions it */
    int link_up;
    int has_trusted;
    long long trusted_epoch;
    long long trusted_anchor_mono;
    long long mono;
    long long wall;

    /* Counters are exact to 2^53-1 (rule SCAN-R15). */
    unsigned long long next_seq;
    unsigned long long next_record_id;
    unsigned long long scans_total;
    unsigned long long admitted_total; /* THIS door's admissions; a replay never moves it */
    unsigned long long refused_total;
    unsigned long long queued_total;
    unsigned long long uploaded_total;
    unsigned long long queue_evicted_total;
    unsigned long long replay_total;
    unsigned long long replay_absorbed_total;
    unsigned long long sync_offline_total;
    unsigned long long time_rejected_total;
    unsigned long long unknown_event_total;
    unsigned long long refused_by_reason[TF_REASON_COUNT];

    /* ---- the admitted set: open addressing, never evicted ---- */
    tf_admit *admitted;
    size_t admitted_cap;
    size_t admitted_count;

    /* ---- the offline queue: a bounded FIFO ring ---- */
    tf_record *queue;
    size_t queue_cap;
    size_t queue_head;
    size_t queue_len;

    /* ---- not yet appended to the two append-only logs ----
     * admitted.log and uploaded.log are append-only (rule SCAN-R17), so they
     * cannot be rewritten the way counters.json and queue.log are. What is new
     * since the last persist waits here, and tf_state_persist() appends it.
     * Both buffers are emptied by every persist, so they never grow. */
    tf_admit *pending_admit;
    size_t pending_admit_len;
    size_t pending_admit_cap;
    tf_record *pending_upload;
    size_t pending_upload_len;
    size_t pending_upload_cap;
} tf_state;

/* Read the state directory, creating it if it is not there. Returns 0, or -1
 * with the reason already placed in *err (a static string). */
int tf_state_open(tf_state *st, const char *dir, size_t queue_max, const char **err);
void tf_state_free(tf_state *st);

/* Persist every file in the state directory (rule SCAN-R03). Returns 0 or -1. */
int tf_state_persist(tf_state *st);

/* The last authoritative time carried forward by monotonic elapsed time
 * (rule SCAN-R09). Returns -1 when no trusted time has ever been obtained. */
long long tf_trusted_now(const tf_state *st);

int tf_admitted_contains(const tf_state *st, const char *ticket_id);

/* 1 if the ticket was new to this device, 0 if it was already admitted (in
 * which case absolutely nothing changes: rule SCAN-R06). */
int tf_admitted_insert(tf_state *st, const char *ticket_id, long long at, int from_replay);

/* Append a scan to the offline queue. Its bound is --queue-max (SCAN-R07). */
void tf_queue_push(tf_state *st, const tf_record *rec);

/* Hand the whole queue upstream, in order, and clear it. Returns how many went.
 * A no-op with the link down. */
size_t tf_queue_upload(tf_state *st);

#endif /* TF_STATE_H */
