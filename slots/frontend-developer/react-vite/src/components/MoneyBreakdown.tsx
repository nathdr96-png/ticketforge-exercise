import type { Currency } from "../lib/contract";
import { formatMoney } from "../lib/money";

export interface BreakdownProps {
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
  totalCents: number;
  currency: Currency | string;
  /** Rendered on the total row; the order confirmation uses `order-total`. */
  totalTestId?: string;
  idPrefix: string;
  note?: string;
}

/**
 * Subtotal / discount / fee / total. Every number arrives as integer cents and
 * is formatted by `formatMoney`, which never performs float arithmetic.
 */
export function MoneyBreakdown({
  subtotalCents,
  discountCents,
  feeCents,
  totalCents,
  currency,
  totalTestId,
  idPrefix,
  note,
}: BreakdownProps): JSX.Element {
  return (
    <dl className="breakdown" data-testid={`${idPrefix}-breakdown`}>
      <div className="breakdown__row">
        <dt>Subtotal</dt>
        <dd data-testid={`${idPrefix}-subtotal`} data-cents={subtotalCents}>
          {formatMoney(subtotalCents, currency)}
        </dd>
      </div>
      <div className="breakdown__row">
        <dt>Discount</dt>
        <dd data-testid={`${idPrefix}-discount`} data-cents={discountCents}>
          {discountCents > 0 ? `−${formatMoney(discountCents, currency)}` : formatMoney(0, currency)}
        </dd>
      </div>
      <div className="breakdown__row">
        <dt>Service fee</dt>
        <dd data-testid={`${idPrefix}-fee`} data-cents={feeCents}>
          {formatMoney(feeCents, currency)}
        </dd>
      </div>
      <div className="breakdown__row breakdown__row--total">
        <dt>Total</dt>
        <dd data-testid={totalTestId ?? `${idPrefix}-total`} data-cents={totalCents}>
          {formatMoney(totalCents, currency)}
        </dd>
      </div>
      {note ? <p className="breakdown__note">{note}</p> : null}
    </dl>
  );
}
