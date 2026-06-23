/* Ticket blobs: the only thing an offline turnstile has to go on.
 *
 * The device holds no ticket database — it cannot, it is offline — so every
 * fact needed to decide an admission travels in the blob, and the signature is
 * what stops the blob being edited on the way.
 *
 * Format and limits are contract/scanner/interface.yaml; the reasoning is in
 * contract/scanner/README.md.
 */
#ifndef TF_TICKET_H
#define TF_TICKET_H

#include <stddef.h>
#include <stdint.h>

/* Declared maxima. A field longer than its maximum is MALFORMED (rule
 * SCAN-R13). These bytes arrive from a barcode held by a member of the public. */
#define TF_TICKET_ID_MAX 64
#define TF_EVENT_ID_MAX 32
#define TF_SEAT_ID_MAX 32
#define TF_BLOB_MAX 256
#define TF_LINE_MAX 1024
#define TF_SIG_HEX 16

typedef struct {
    char ticket_id[TF_TICKET_ID_MAX + 1];
    char event_id[TF_EVENT_ID_MAX + 1];
    char seat_id[TF_SEAT_ID_MAX + 1];
    long long valid_from;
    long long valid_to;
    char signature[TF_SIG_HEX + 1];
} tf_ticket;

uint64_t tf_fnv1a64(const char *data, size_t len);

/* 0 on success, -1 if the blob is not a well-formed ticket. On -1 the contents
 * of *out are unspecified and the caller must report "-" as the ticket id. */
int tf_parse_blob(const char *blob, tf_ticket *out);

#endif /* TF_TICKET_H */
