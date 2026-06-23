/* The admission decision, in one function, in the declared precedence order.
 *
 * Kept apart from the transcript loop and from the state files on purpose: this
 * is the part a reviewer reads to check it against
 * contract/scanner/interface.yaml, and the part the unit tests in tests/ call
 * directly without touching a disk.
 */
#ifndef TF_DECIDE_H
#define TF_DECIDE_H

#include "state.h"
#include "ticket.h"

/* Decide one SCAN. Reads the state (the gate, the admitted set, the trusted
 * clock) and changes none of it — the caller records the outcome.
 *
 * On return, *ticket holds the parsed ticket when the blob parsed, and
 * *parsed says whether it did. When it did not, the decision is TF_MALFORMED
 * and the caller must print "-" rather than anything out of *ticket. */
tf_reason tf_decide(const tf_state *st, const char *blob, tf_ticket *ticket, int *parsed);

#endif /* TF_DECIDE_H */
