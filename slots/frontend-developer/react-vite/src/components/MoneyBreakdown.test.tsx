import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoneyBreakdown } from "./MoneyBreakdown";

describe("<MoneyBreakdown />", () => {
  it("renders every line in integer-cent-correct form with data-cents", () => {
    render(
      <MoneyBreakdown
        idPrefix="order"
        subtotalCents={21000}
        discountCents={4200}
        feeCents={870}
        totalCents={17670}
        currency="USD"
        totalTestId="order-total"
      />,
    );

    expect(screen.getByTestId("order-subtotal")).toHaveTextContent("$210.00");
    expect(screen.getByTestId("order-discount")).toHaveTextContent("$42.00");
    expect(screen.getByTestId("order-fee")).toHaveTextContent("$8.70");

    const total = screen.getByTestId("order-total");
    expect(total).toHaveTextContent("$176.70");
    // contract/testids.md: order-total must carry the amount in minor units.
    expect(total.getAttribute("data-cents")).toBe("17670");
  });

  it("renders a zero discount as a plain zero", () => {
    render(
      <MoneyBreakdown
        idPrefix="checkout"
        subtotalCents={7000}
        discountCents={0}
        feeCents={380}
        totalCents={7380}
        currency="EUR"
      />,
    );
    expect(screen.getByTestId("checkout-discount")).toHaveTextContent("€0.00");
    expect(screen.getByTestId("checkout-total").getAttribute("data-cents")).toBe("7380");
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("€73.80");
  });
});
