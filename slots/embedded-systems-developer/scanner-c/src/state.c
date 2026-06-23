#define _POSIX_C_SOURCE 200809L

#include "state.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static const char *const REASON_NAMES[TF_REASON_COUNT] = {
    "MALFORMED", "BAD_SIGNATURE", "NOT_COMMISSIONED", "WRONG_EVENT",
    "DUPLICATE", "NO_TRUSTED_TIME", "NOT_YET_VALID", "EXPIRED", "OK",
};

const char *tf_reason_name(tf_reason r)
{
    if (r < 0 || r >= TF_REASON_COUNT)
        return "MALFORMED";
    return REASON_NAMES[r];
}

static tf_reason reason_from_name(const char *name)
{
    for (int i = 0; i < TF_REASON_COUNT; i++) {
        if (strcmp(name, REASON_NAMES[i]) == 0)
            return (tf_reason)i;
    }
    return TF_MALFORMED;
}

/* ------------------------------------------------------------------ paths */

static void path_of(const tf_state *st, const char *name, char *out, size_t cap)
{
    snprintf(out, cap, "%s/%s", st->dir, name);
}

/* Read a whole file. Returns a NUL-terminated buffer the caller frees, or NULL
 * if the file is not there (which on a fresh device is the normal case). */
static char *read_file(const char *path, size_t *len_out)
{
    FILE *f = fopen(path, "rb");
    if (f == NULL)
        return NULL;
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return NULL;
    }
    long size = ftell(f);
    if (size < 0 || fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return NULL;
    }
    char *buf = malloc((size_t)size + 1);
    if (buf == NULL) {
        fclose(f);
        return NULL;
    }
    size_t got = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[got] = '\0';
    if (len_out != NULL)
        *len_out = got;
    return buf;
}

/* Replace a file's whole contents. tmp + fsync + rename, so a reader never
 * sees a half-written file: counters.json and queue.log are both rewritten in
 * full on every event and a torn one would be worse than a stale one. */
static int write_whole(const char *path, const char *data, size_t len)
{
    char tmp[4096];
    snprintf(tmp, sizeof(tmp), "%s.tmp", path);
    int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0)
        return -1;
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(fd, data + off, len - off);
        if (n < 0) {
            if (errno == EINTR)
                continue;
            close(fd);
            return -1;
        }
        off += (size_t)n;
    }
    if (fsync(fd) != 0) {
        close(fd);
        return -1;
    }
    if (close(fd) != 0)
        return -1;
    return rename(tmp, path);
}

static int append_bytes(const char *path, const char *data, size_t len)
{
    if (len == 0)
        return 0;
    int fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd < 0)
        return -1;
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(fd, data + off, len - off);
        if (n < 0) {
            if (errno == EINTR)
                continue;
            close(fd);
            return -1;
        }
        off += (size_t)n;
    }
    if (fsync(fd) != 0) {
        close(fd);
        return -1;
    }
    return close(fd);
}

/* ------------------------------------------------------ a very small JSON */

/* counters.json is written by this program and read back by this program, so a
 * full parser would be a liability rather than an asset: more code to get wrong
 * on a device with no way to report an error. These three helpers find a
 * top-level key and read the scalar after it, and anything they cannot
 * understand leaves the caller's default in place. */

static const char *find_key(const char *json, const char *key)
{
    char needle[96];
    snprintf(needle, sizeof(needle), "\"%s\"", key);
    const char *p = strstr(json, needle);
    if (p == NULL)
        return NULL;
    p += strlen(needle);
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')
        p++;
    if (*p != ':')
        return NULL;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')
        p++;
    return p;
}

static void json_ull(const char *json, const char *key, unsigned long long *out)
{
    const char *p = find_key(json, key);
    if (p == NULL || *p < '0' || *p > '9')
        return;
    *out = strtoull(p, NULL, 10);
}

static void json_ll(const char *json, const char *key, long long *out, int *present)
{
    const char *p = find_key(json, key);
    if (p == NULL)
        return;
    if (strncmp(p, "null", 4) == 0) {
        if (present != NULL)
            *present = 0;
        return;
    }
    if (*p != '-' && (*p < '0' || *p > '9'))
        return;
    *out = strtoll(p, NULL, 10);
    if (present != NULL)
        *present = 1;
}

static void json_bool(const char *json, const char *key, int *out)
{
    const char *p = find_key(json, key);
    if (p == NULL)
        return;
    *out = (strncmp(p, "true", 4) == 0);
}

static void json_str(const char *json, const char *key, char *out, size_t cap)
{
    const char *p = find_key(json, key);
    if (p == NULL)
        return;
    if (strncmp(p, "null", 4) == 0) {
        out[0] = '\0';
        return;
    }
    if (*p != '"')
        return;
    p++;
    size_t i = 0;
    while (*p != '"' && *p != '\0' && i < cap)
        out[i++] = *p++;
    out[i] = '\0';
}

/* ------------------------------------------------------------- admitted set */

static size_t hash_id(const char *ticket_id, size_t cap)
{
    return (size_t)(tf_fnv1a64(ticket_id, strlen(ticket_id)) & (uint64_t)(cap - 1));
}

static int admitted_grow(tf_state *st, size_t want_cap)
{
    tf_admit *fresh = calloc(want_cap, sizeof(*fresh));
    if (fresh == NULL)
        return -1;
    for (size_t i = 0; i < st->admitted_cap; i++) {
        if (st->admitted[i].ticket_id[0] == '\0')
            continue;
        size_t j = hash_id(st->admitted[i].ticket_id, want_cap);
        while (fresh[j].ticket_id[0] != '\0')
            j = (j + 1) & (want_cap - 1);
        fresh[j] = st->admitted[i];
    }
    free(st->admitted);
    st->admitted = fresh;
    st->admitted_cap = want_cap;
    return 0;
}

int tf_admitted_contains(const tf_state *st, const char *ticket_id)
{
    if (st->admitted_cap == 0)
        return 0;
    size_t j = hash_id(ticket_id, st->admitted_cap);
    for (size_t probe = 0; probe < st->admitted_cap; probe++) {
        if (st->admitted[j].ticket_id[0] == '\0')
            return 0;
        if (strcmp(st->admitted[j].ticket_id, ticket_id) == 0)
            return 1;
        j = (j + 1) & (st->admitted_cap - 1);
    }
    return 0;
}

static int pending_admit_push(tf_state *st, const tf_admit *entry)
{
    if (st->pending_admit_len == st->pending_admit_cap) {
        size_t cap = st->pending_admit_cap ? st->pending_admit_cap * 2 : 16;
        tf_admit *grown = realloc(st->pending_admit, cap * sizeof(*grown));
        if (grown == NULL)
            return -1;
        st->pending_admit = grown;
        st->pending_admit_cap = cap;
    }
    st->pending_admit[st->pending_admit_len++] = *entry;
    return 0;
}

static int admitted_insert_raw(tf_state *st, const char *ticket_id, long long at, int from_replay)
{
    if (st->admitted_count * 10 >= st->admitted_cap * 7) {
        if (admitted_grow(st, st->admitted_cap ? st->admitted_cap * 2 : 64) != 0)
            return -1;
    }
    size_t j = hash_id(ticket_id, st->admitted_cap);
    while (st->admitted[j].ticket_id[0] != '\0') {
        if (strcmp(st->admitted[j].ticket_id, ticket_id) == 0)
            return 0; /* already known: change nothing at all */
        j = (j + 1) & (st->admitted_cap - 1);
    }
    snprintf(st->admitted[j].ticket_id, sizeof(st->admitted[j].ticket_id), "%s", ticket_id);
    st->admitted[j].admitted_at = at;
    st->admitted[j].from_replay = from_replay;
    st->admitted_count++;
    return 1;
}

int tf_admitted_insert(tf_state *st, const char *ticket_id, long long at, int from_replay)
{
    if (tf_admitted_contains(st, ticket_id))
        return 0;
    if (admitted_insert_raw(st, ticket_id, at, from_replay) != 1)
        return 0;
    tf_admit entry;
    memset(&entry, 0, sizeof(entry));
    snprintf(entry.ticket_id, sizeof(entry.ticket_id), "%s", ticket_id);
    entry.admitted_at = at;
    entry.from_replay = from_replay;
    if (pending_admit_push(st, &entry) != 0)
        return 0;
    return 1;
}

/* ------------------------------------------------------------------- queue */

void tf_queue_push(tf_state *st, const tf_record *rec)
{
    if (st->queue_cap == 0)
        return;
    if (st->queue_len == st->queue_cap) {
        /* Never drop a record: give the queue more room instead. */
        size_t want = st->queue_cap * 2;
        tf_record *grown = calloc(want, sizeof(*grown));
        if (grown == NULL)
            return;
        for (size_t i = 0; i < st->queue_len; i++)
            grown[i] = st->queue[(st->queue_head + i) % st->queue_cap];
        free(st->queue);
        st->queue = grown;
        st->queue_cap = want;
        st->queue_head = 0;
    }
    size_t slot = (st->queue_head + st->queue_len) % st->queue_cap;
    st->queue[slot] = *rec;
    st->queue_len++;
}

static int pending_upload_push(tf_state *st, const tf_record *rec)
{
    if (st->pending_upload_len == st->pending_upload_cap) {
        size_t cap = st->pending_upload_cap ? st->pending_upload_cap * 2 : 16;
        tf_record *grown = realloc(st->pending_upload, cap * sizeof(*grown));
        if (grown == NULL)
            return -1;
        st->pending_upload = grown;
        st->pending_upload_cap = cap;
    }
    st->pending_upload[st->pending_upload_len++] = *rec;
    return 0;
}

size_t tf_queue_upload(tf_state *st)
{
    if (!st->link_up) {
        st->sync_offline_total++;
        return 0;
    }
    size_t sent = 0;
    while (st->queue_len > 0) {
        const tf_record *rec = &st->queue[st->queue_head];
        if (pending_upload_push(st, rec) != 0)
            break;
        st->queue_head = (st->queue_head + 1) % st->queue_cap;
        st->queue_len--;
        st->uploaded_total++;
        sent++;
    }
    return sent;
}

/* ------------------------------------------------------------------- clock */

long long tf_trusted_now(const tf_state *st)
{
    if (!st->has_trusted)
        return -1;
    return st->trusted_epoch + (st->mono - st->trusted_anchor_mono);
}

/* ------------------------------------------------------------- open / free */

static void load_counters(tf_state *st, const char *json)
{
    json_str(json, "gate_event_id", st->gate_event_id, TF_EVENT_ID_MAX);
    json_bool(json, "link_up", &st->link_up);
    st->has_trusted = 0;
    json_ll(json, "trusted_epoch", &st->trusted_epoch, &st->has_trusted);
    json_ll(json, "trusted_anchor_mono", &st->trusted_anchor_mono, NULL);
    json_ll(json, "mono", &st->mono, NULL);
    json_ll(json, "wall", &st->wall, NULL);
    json_ull(json, "next_seq", &st->next_seq);
    json_ull(json, "next_record_id", &st->next_record_id);
    json_ull(json, "scans_total", &st->scans_total);
    json_ull(json, "admitted_total", &st->admitted_total);
    json_ull(json, "refused_total", &st->refused_total);
    json_ull(json, "queued_total", &st->queued_total);
    json_ull(json, "uploaded_total", &st->uploaded_total);
    json_ull(json, "queue_evicted_total", &st->queue_evicted_total);
    json_ull(json, "replay_total", &st->replay_total);
    json_ull(json, "replay_absorbed_total", &st->replay_absorbed_total);
    json_ull(json, "sync_offline_total", &st->sync_offline_total);
    json_ull(json, "time_rejected_total", &st->time_rejected_total);
    json_ull(json, "unknown_event_total", &st->unknown_event_total);

    const char *block = strstr(json, "\"refused_by_reason\"");
    if (block != NULL) {
        const char *end = strchr(block, '}');
        if (end != NULL) {
            size_t len = (size_t)(end - block) + 1;
            char *copy = malloc(len + 1);
            if (copy != NULL) {
                memcpy(copy, block, len);
                copy[len] = '\0';
                for (int i = 0; i < TF_REASON_COUNT; i++)
                    json_ull(copy, REASON_NAMES[i], &st->refused_by_reason[i]);
                free(copy);
            }
        }
    }
}

static void load_admitted(tf_state *st, const char *text)
{
    const char *p = text;
    while (*p != '\0') {
        const char *nl = strchr(p, '\n');
        size_t len = (nl != NULL) ? (size_t)(nl - p) : strlen(p);
        if (len > 0 && len < 256) {
            char line[256];
            memcpy(line, p, len);
            line[len] = '\0';
            char id[TF_TICKET_ID_MAX + 1] = "";
            long long at = -1;
            char source[16] = "";
            if (sscanf(line, "%64s %lld %15s", id, &at, source) == 3)
                (void)admitted_insert_raw(st, id, at, strcmp(source, "REPLAY") == 0);
        }
        if (nl == NULL)
            break;
        p = nl + 1;
    }
}

static void load_queue(tf_state *st, const char *text)
{
    const char *p = text;
    while (*p != '\0') {
        const char *nl = strchr(p, '\n');
        size_t len = (nl != NULL) ? (size_t)(nl - p) : strlen(p);
        if (len > 0 && len < 512) {
            char line[512];
            memcpy(line, p, len);
            line[len] = '\0';
            tf_record rec;
            memset(&rec, 0, sizeof(rec));
            char decision[16] = "";
            char reason[TF_REASON_NAME_MAX + 1] = "";
            if (sscanf(line, "%llu %64s %lld %15s %20s", &rec.record_id, rec.ticket_id,
                       &rec.scanned_at, decision, reason) == 5) {
                rec.admitted = (strcmp(decision, "ADMIT") == 0);
                rec.reason = reason_from_name(reason);
                tf_queue_push(st, &rec);
            }
        }
        if (nl == NULL)
            break;
        p = nl + 1;
    }
}

int tf_state_open(tf_state *st, const char *dir, size_t queue_max, const char **err)
{
    memset(st, 0, sizeof(*st));
    if (strlen(dir) + 32 >= sizeof(st->dir)) {
        *err = "state directory path is too long";
        return -1;
    }
    snprintf(st->dir, sizeof(st->dir), "%s", dir);
    st->queue_max = queue_max;
    st->next_seq = 1;
    st->next_record_id = 1;
    st->trusted_epoch = 0;
    st->trusted_anchor_mono = 0;

    if (mkdir(dir, 0755) != 0 && errno != EEXIST) {
        *err = "could not create the state directory";
        return -1;
    }

    st->queue_cap = queue_max;
    st->queue = calloc(queue_max ? queue_max : 1, sizeof(*st->queue));
    if (st->queue == NULL) {
        *err = "out of memory allocating the offline queue";
        return -1;
    }
    if (admitted_grow(st, 64) != 0) {
        *err = "out of memory allocating the admitted set";
        return -1;
    }

    char path[4096];
    path_of(st, "counters.json", path, sizeof(path));
    char *json = read_file(path, NULL);
    if (json != NULL) {
        load_counters(st, json);
        free(json);
    }
    path_of(st, "admitted.log", path, sizeof(path));
    char *adm = read_file(path, NULL);
    if (adm != NULL) {
        load_admitted(st, adm);
        free(adm);
    }
    path_of(st, "queue.log", path, sizeof(path));
    char *q = read_file(path, NULL);
    if (q != NULL) {
        load_queue(st, q);
        free(q);
    }
    /* queue_depth and admitted_known are deliberately NOT read back from
     * counters.json: the two logs are the evidence and the summary is derived
     * from them. A disagreement then resolves in favour of what is actually on
     * the flash instead of in favour of whichever file was written last. */
    return 0;
}

void tf_state_free(tf_state *st)
{
    free(st->admitted);
    free(st->queue);
    free(st->pending_admit);
    free(st->pending_upload);
    st->admitted = NULL;
    st->queue = NULL;
    st->pending_admit = NULL;
    st->pending_upload = NULL;
}

/* ----------------------------------------------------------------- persist */

static int persist_counters(tf_state *st)
{
    char buf[4096];
    int n = 0;
    n += snprintf(buf + n, sizeof(buf) - (size_t)n, "{\n");
    if (st->gate_event_id[0] != '\0')
        n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                      "  \"gate_event_id\": \"%s\",\n", st->gate_event_id);
    else
        n += snprintf(buf + n, sizeof(buf) - (size_t)n, "  \"gate_event_id\": null,\n");
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"link_up\": %s,\n", st->link_up ? "true" : "false");
    if (st->has_trusted)
        n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                      "  \"trusted_epoch\": %lld,\n", st->trusted_epoch);
    else
        n += snprintf(buf + n, sizeof(buf) - (size_t)n, "  \"trusted_epoch\": null,\n");
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"trusted_anchor_mono\": %lld,\n", st->trusted_anchor_mono);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n, "  \"mono\": %lld,\n", st->mono);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n, "  \"wall\": %lld,\n", st->wall);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n, "  \"next_seq\": %llu,\n", st->next_seq);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"next_record_id\": %llu,\n", st->next_record_id);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"scans_total\": %llu,\n", st->scans_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"admitted_total\": %llu,\n", st->admitted_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"refused_total\": %llu,\n", st->refused_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n, "  \"refused_by_reason\": {");
    int first = 1;
    for (int i = 0; i < TF_REASON_COUNT; i++) {
        if (st->refused_by_reason[i] == 0)
            continue;
        n += snprintf(buf + n, sizeof(buf) - (size_t)n, "%s\n    \"%s\": %llu",
                      first ? "" : ",", REASON_NAMES[i], st->refused_by_reason[i]);
        first = 0;
    }
    n += snprintf(buf + n, sizeof(buf) - (size_t)n, first ? "},\n" : "\n  },\n");
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"queued_total\": %llu,\n", st->queued_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"uploaded_total\": %llu,\n", st->uploaded_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"queue_evicted_total\": %llu,\n", st->queue_evicted_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"queue_depth\": %zu,\n", st->queue_len);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"replay_total\": %llu,\n", st->replay_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"replay_absorbed_total\": %llu,\n", st->replay_absorbed_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"admitted_known\": %zu,\n", st->admitted_count);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"sync_offline_total\": %llu,\n", st->sync_offline_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"time_rejected_total\": %llu,\n", st->time_rejected_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"unknown_event_total\": %llu,\n", st->unknown_event_total);
    n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                  "  \"queue_max\": %zu\n}\n", st->queue_max);
    if (n < 0 || (size_t)n >= sizeof(buf))
        return -1;

    char path[4096];
    path_of(st, "counters.json", path, sizeof(path));
    return write_whole(path, buf, (size_t)n);
}

static void record_line(const tf_record *rec, char *out, size_t cap)
{
    snprintf(out, cap, "%llu %s %lld %s %s\n", rec->record_id,
             rec->ticket_id[0] ? rec->ticket_id : "-", rec->scanned_at,
             rec->admitted ? "ADMIT" : "REFUSE", tf_reason_name(rec->reason));
}

static int persist_queue(tf_state *st)
{
    /* The whole queue is rewritten in full. Eviction is then simply "it is not
     * in the file any more", with no compaction pass to get wrong.
     *
     * The buffer is sized from how many records there actually ARE, not from
     * queue_max. They are the same number in a correct device, and that is
     * exactly why: if the queue is ever longer than its bound, this function
     * must still write it out. A buffer sized by the bound would instead start
     * silently failing to persist anything at all, which would turn a visible
     * bug about the bound into an invisible one about durability. */
    size_t cap = (st->queue_len + 1) * 160 + 1;
    char *buf = malloc(cap);
    if (buf == NULL)
        return -1;
    size_t used = 0;
    for (size_t i = 0; i < st->queue_len; i++) {
        const tf_record *rec = &st->queue[(st->queue_head + i) % st->queue_cap];
        char line[256];
        record_line(rec, line, sizeof(line));
        size_t len = strlen(line);
        if (used + len >= cap) {
            free(buf);
            return -1;
        }
        memcpy(buf + used, line, len);
        used += len;
    }
    char path[4096];
    path_of(st, "queue.log", path, sizeof(path));
    int rc = write_whole(path, buf, used);
    free(buf);
    return rc;
}

static int persist_appends(tf_state *st)
{
    char path[4096];

    if (st->pending_admit_len > 0) {
        size_t cap = st->pending_admit_len * 128 + 1;
        char *buf = malloc(cap);
        if (buf == NULL)
            return -1;
        size_t used = 0;
        for (size_t i = 0; i < st->pending_admit_len; i++) {
            const tf_admit *a = &st->pending_admit[i];
            char line[160];
            snprintf(line, sizeof(line), "%s %lld %s\n", a->ticket_id, a->admitted_at,
                     a->from_replay ? "REPLAY" : "LOCAL");
            size_t len = strlen(line);
            if (used + len >= cap) {
                free(buf);
                return -1;
            }
            memcpy(buf + used, line, len);
            used += len;
        }
        path_of(st, "admitted.log", path, sizeof(path));
        int rc = append_bytes(path, buf, used);
        free(buf);
        if (rc != 0)
            return -1;
        st->pending_admit_len = 0;
    }

    if (st->pending_upload_len > 0) {
        size_t cap = st->pending_upload_len * 256 + 1;
        char *buf = malloc(cap);
        if (buf == NULL)
            return -1;
        size_t used = 0;
        for (size_t i = 0; i < st->pending_upload_len; i++) {
            char line[256];
            record_line(&st->pending_upload[i], line, sizeof(line));
            size_t len = strlen(line);
            if (used + len >= cap) {
                free(buf);
                return -1;
            }
            memcpy(buf + used, line, len);
            used += len;
        }
        path_of(st, "uploaded.log", path, sizeof(path));
        int rc = append_bytes(path, buf, used);
        free(buf);
        if (rc != 0)
            return -1;
        st->pending_upload_len = 0;
    }
    return 0;
}

int tf_state_persist(tf_state *st)
{
    /* Order matters. The two append-only logs go first, then the queue, then
     * counters.json last: counters.json is the summary, so if the power goes
     * mid-persist the summary is the thing that is stale rather than the
     * evidence being the thing that is missing. */
    if (persist_appends(st) != 0)
        return -1;
    if (persist_queue(st) != 0)
        return -1;
    return persist_counters(st);
}
