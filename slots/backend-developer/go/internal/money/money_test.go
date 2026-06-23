package money

import "testing"

const (
	feePercent = 5
	feeFixed   = 30
)

func TestFeeCents(t *testing.T) {
	cases := []struct {
		subtotal int
		want     int
	}{
		{5000, 280}, // 250 + 30
		{0, 30},     // fixed only
		{99, 34},    // floor(4.95) = 4, + 30
		{1, 30},     // floor(0.05) = 0, + 30
		{7000, 380}, // 350 + 30
		{6300, 345}, // 315 + 30
		{2500, 155}, // 125 + 30
		{19, 30},    // floor(0.95) = 0
		{20, 31},    // floor(1.0) = 1
		{123456, 6202},
	}
	for _, c := range cases {
		if got := FeeCents(c.subtotal, feePercent, feeFixed); got != c.want {
			t.Errorf("FeeCents(%d) = %d, want %d", c.subtotal, got, c.want)
		}
	}
}

func TestFeeCentsFloorsNotRounds(t *testing.T) {
	// 99 * 5 / 100 = 4.95 → must floor to 4, never round to 5.
	if got := FeeCents(99, feePercent, 0); got != 4 {
		t.Fatalf("FeeCents(99) = %d, want 4 (floor, not round)", got)
	}
	// 1999 * 5 / 100 = 99.95 → 99
	if got := FeeCents(1999, feePercent, 0); got != 99 {
		t.Fatalf("FeeCents(1999) = %d, want 99", got)
	}
}

func TestDiscountCents(t *testing.T) {
	cases := []struct {
		subtotal   int
		percentOff int
		want       int
	}{
		{5000, 10, 500},
		{3333, 10, 333}, // floor(333.3)
		{7000, 20, 1400},
		{1111, 15, 166}, // floor(166.65)
		{999, 50, 499},  // floor(499.5)
		{5000, 0, 0},
		{0, 10, 0},
		{5000, 100, 5000},
	}
	for _, c := range cases {
		if got := DiscountCents(c.subtotal, c.percentOff); got != c.want {
			t.Errorf("DiscountCents(%d, %d) = %d, want %d", c.subtotal, c.percentOff, got, c.want)
		}
	}
}

func TestOrderTotalIdentity(t *testing.T) {
	// Fee is charged on the POST-discount subtotal.
	subtotal := 7500
	discount := DiscountCents(subtotal, 10)
	if discount != 750 {
		t.Fatalf("discount = %d, want 750", discount)
	}
	fee := FeeCents(subtotal-discount, feePercent, feeFixed)
	if fee != 367 { // floor(6750*5/100)=337 + 30
		t.Fatalf("fee = %d, want 367", fee)
	}
	total := TotalCents(subtotal, discount, fee)
	if total != 6750+367 {
		t.Fatalf("total = %d, want %d", total, 6750+367)
	}
}

func TestFeeChargedOnPostDiscountSubtotal(t *testing.T) {
	// A seat priced 7000 with SAVE10 (as the conformance suite exercises).
	subtotal := 7000
	discount := DiscountCents(subtotal, 10) // 700
	preDiscountFee := FeeCents(subtotal, feePercent, feeFixed)
	postDiscountFee := FeeCents(subtotal-discount, feePercent, feeFixed)
	if preDiscountFee == postDiscountFee {
		t.Fatal("fee must differ when computed on the post-discount subtotal")
	}
	if postDiscountFee != 345 { // floor(6300*5/100)=315 + 30
		t.Fatalf("postDiscountFee = %d, want 345", postDiscountFee)
	}
	if TotalCents(subtotal, discount, postDiscountFee) != 6645 {
		t.Fatalf("total = %d, want 6645", TotalCents(subtotal, discount, postDiscountFee))
	}
}
