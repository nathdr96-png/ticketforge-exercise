#include "decide.h"

#include <string.h>

tf_reason tf_decide(const tf_state *st, const char *blob, tf_ticket *ticket, int *parsed)
{
    memset(ticket, 0, sizeof(*ticket));
    *parsed = 0;

    /* The precedence below is declared in contract/scanner/interface.yaml and
     * two steps of it are decisions rather than conveniences:
     *
     *   MALFORMED first, so nothing else about a blob is looked at until it
     *   has parsed. These bytes come off a barcode held by a member of the
     *   public.
     *
     *   DUPLICATE before any of the time checks, so that a ticket which has
     *   already been through this turnstile reads DUPLICATE whatever the clock
     *   says. "Already used" does not depend on the time, and it is the answer
     *   the person on the door can act on. */

    if (tf_parse_blob(blob, ticket) != 0)
        return TF_MALFORMED;
    *parsed = 1;

    /* TODO(FEAT-1112): the ticket's fields are not authenticated yet, so a
     * reprinted barcode with an edited window is accepted. */

    if (st->gate_event_id[0] == '\0')
        return TF_NOT_COMMISSIONED;

    if (strcmp(ticket->event_id, st->gate_event_id) != 0)
        return TF_WRONG_EVENT;

    if (tf_admitted_contains(st, ticket->ticket_id))
        return TF_DUPLICATE;

    /* Validity is decided against the ticket's own signed window and the
     * device's TRUSTED clock — the last authoritative time from upstream
     * carried forward by monotonic elapsed time. st->wall is never read here,
     * and that is rule SCAN-R09: coin cells die, and the local clock is the one
     * input somebody standing at this door can influence. */
    long long now = tf_trusted_now(st);
    if (now < 0)
        return TF_NO_TRUSTED_TIME;
    if (now < ticket->valid_from)
        return TF_NOT_YET_VALID;
    if (now > ticket->valid_to)
        return TF_EXPIRED;

    return TF_OK;
}
