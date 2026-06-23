#include "ticket.h"

#include <stdio.h>
#include <string.h>

uint64_t tf_fnv1a64(const char *data, size_t len)
{
    uint64_t h = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < len; i++) {
        h ^= (uint64_t)(unsigned char)data[i];
        h *= 0x100000001b3ULL;
    }
    return h;
}

/* Copy one '|'-delimited field. The length is MEASURED FIRST and the copy only
 * happens if it fits: this is rule SCAN-R13, and it is the whole reason the
 * 310-byte ticket id in s10-bad-tickets is a refusal and not a crash. */
static int copy_field(const char *start, const char *end, char *dst, size_t cap)
{
    size_t len = (size_t)(end - start);
    if (len == 0 || len > cap)
        return -1;
    memcpy(dst, start, len);
    dst[len] = '\0';
    return 0;
}

/* Strict non-negative decimal. strtoll would accept "+1", " 1", "0x10" and
 * trailing junk, none of which a signed field may contain. */
static int parse_u63(const char *s, long long *out)
{
    if (*s == '\0')
        return -1;
    long long v = 0;
    for (const char *p = s; *p; p++) {
        if (*p < '0' || *p > '9')
            return -1;
        if (v > (9007199254740991LL - (*p - '0')) / 10)
            return -1; /* beyond the declared exact bound: not a ticket we issued */
        v = v * 10 + (*p - '0');
    }
    *out = v;
    return 0;
}

static int is_lower_hex(const char *s, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        char c = s[i];
        int ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
        if (!ok)
            return 0;
    }
    return 1;
}

int tf_parse_blob(const char *blob, tf_ticket *out)
{
    if (blob == NULL)
        return -1;

    size_t blob_len = strlen(blob);
    if (blob_len == 0 || blob_len > TF_BLOB_MAX)
        return -1;

    /* Six fields, five separators, no more and no fewer. */
    const char *bounds[7];
    bounds[0] = blob;
    size_t found = 0;
    for (const char *p = blob; *p; p++) {
        if (*p != '|')
            continue;
        if (found == 5)
            return -1;
        bounds[++found] = p + 1;
    }
    if (found != 5)
        return -1;
    bounds[6] = blob + blob_len + 1;

#define FIELD_START(i) (bounds[i])
#define FIELD_END(i) (bounds[(i) + 1] - 1)

    if (copy_field(FIELD_START(0), FIELD_END(0), out->ticket_id, TF_TICKET_ID_MAX) != 0)
        return -1;
    if (copy_field(FIELD_START(1), FIELD_END(1), out->event_id, TF_EVENT_ID_MAX) != 0)
        return -1;
    if (copy_field(FIELD_START(2), FIELD_END(2), out->seat_id, TF_SEAT_ID_MAX) != 0)
        return -1;

    char from_buf[24];
    char to_buf[24];
    if (copy_field(FIELD_START(3), FIELD_END(3), from_buf, sizeof(from_buf) - 1) != 0)
        return -1;
    if (copy_field(FIELD_START(4), FIELD_END(4), to_buf, sizeof(to_buf) - 1) != 0)
        return -1;
    if (parse_u63(from_buf, &out->valid_from) != 0)
        return -1;
    if (parse_u63(to_buf, &out->valid_to) != 0)
        return -1;
    /* An inverted window is not a window. It is also the shape a hand-edited
     * blob takes when somebody swaps two fields by mistake. */
    if (out->valid_from > out->valid_to)
        return -1;

    if (copy_field(FIELD_START(5), FIELD_END(5), out->signature, TF_SIG_HEX) != 0)
        return -1;
    if (strlen(out->signature) != TF_SIG_HEX)
        return -1;
    if (!is_lower_hex(out->signature, TF_SIG_HEX))
        return -1;

#undef FIELD_START
#undef FIELD_END
    return 0;
}
