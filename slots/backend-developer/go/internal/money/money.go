// Package money holds the canonical TicketForge money math.
//
// Every amount is an integer number of minor units (cents). There are no
// floating point values anywhere on the money path: all arithmetic below is
// integer arithmetic, and Go's integer division truncates toward zero which is
// identical to floor() for the non-negative inputs this domain allows.
package money

// FeeCents implements the canonical fee formula:
//
//	fee_cents = floor(subtotal_after_discount * FEE_PERCENT / 100) + FEE_FIXED_CENTS
func FeeCents(subtotalAfterDiscount, feePercent, feeFixedCents int) int {
	if subtotalAfterDiscount < 0 {
		subtotalAfterDiscount = 0
	}
	return (subtotalAfterDiscount*feePercent)/100 + feeFixedCents
}

// DiscountCents implements:
//
//	discount_cents = floor(subtotal * percent_off / 100)
func DiscountCents(subtotal, percentOff int) int {
	if subtotal < 0 || percentOff <= 0 {
		return 0
	}
	if percentOff > 100 {
		percentOff = 100
	}
	return (subtotal * percentOff) / 100
}

// TotalCents = (subtotal - discount) + fee.
func TotalCents(subtotal, discount, fee int) int {
	return (subtotal - discount) + fee
}
