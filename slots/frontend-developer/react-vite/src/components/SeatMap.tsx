import { memo, useMemo } from "react";
import type { Seat, SeatSection } from "../lib/contract";
import { formatCents } from "../lib/money";

/**
 * One seat. Memoised on primitive props only, so re-rendering the 2,000-seat
 * arena after a selection change touches just the seats that actually changed.
 *
 * contract/testids.md:
 *   - `seat` with `data-seat-id`, `data-section` and `data-status`
 *   - `data-status="available"` plus the `seat-available` marker when available
 */
const SeatButton = memo(function SeatButton({
  id,
  label,
  section,
  status,
  priceCents,
  selected,
  disabled,
  onToggle,
}: {
  id: string;
  label: string;
  section: SeatSection;
  status: Seat["status"];
  priceCents: number;
  selected: boolean;
  disabled: boolean;
  onToggle: (seatId: string) => void;
}) {
  const available = status === "available";
  const className = [
    "seat",
    `seat--${status}`,
    available ? "seat-available" : "",
    selected ? "seat--selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      data-testid="seat"
      data-seat-id={id}
      data-section={section}
      data-status={status}
      data-price-cents={priceCents}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      aria-label={`Seat ${label}, ${status}, ${formatCents(priceCents)}`}
      title={`${label} · ${status} · ${formatCents(priceCents)}`}
      disabled={disabled && !selected}
      onClick={() => onToggle(id)}
    >
      {available ? (
        /* Marker element for the `seat-available` state in contract/testids.md.
           It is the seat's own label, so clicking it clicks the seat. */
        <span className="seat__label seat-available" data-testid="seat-available" data-seat-id={id}>
          {label}
        </span>
      ) : (
        <span className="seat__label">{label}</span>
      )}
    </button>
  );
});

interface SectionGroup {
  section: SeatSection;
  rows: { row: string; seats: Seat[] }[];
}

function groupSeats(seats: Seat[]): SectionGroup[] {
  const bySection = new Map<SeatSection, Map<string, Seat[]>>();
  for (const seat of seats) {
    let rows = bySection.get(seat.section);
    if (!rows) {
      rows = new Map();
      bySection.set(seat.section, rows);
    }
    const row = rows.get(seat.row);
    if (row) row.push(seat);
    else rows.set(seat.row, [seat]);
  }
  return [...bySection.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([section, rows]) => ({
      section,
      rows: [...rows.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([row, rowSeats]) => ({
          row,
          seats: [...rowSeats].sort((a, b) => a.number - b.number),
        })),
    }));
}

export function SeatMap({
  seats,
  selected,
  selectionFull,
  locked,
  onToggle,
}: {
  seats: Seat[];
  selected: ReadonlySet<string>;
  /** Max seats per hold already reached — further available seats are disabled. */
  selectionFull: boolean;
  /** A hold or order exists: the map is read-only until it is released. */
  locked: boolean;
  onToggle: (seatId: string) => void;
}): JSX.Element {
  const groups = useMemo(() => groupSeats(seats), [seats]);

  return (
    <div className="seat-map" data-testid="seat-map" data-seat-count={seats.length}>
      {groups.length === 0 ? (
        <p className="empty" data-testid="seat-map-empty">
          No seats match these filters.
        </p>
      ) : null}
      {groups.map((group) => (
        <section className="seat-section" key={group.section}>
          <h3 className="seat-section__title">Section {group.section}</h3>
          {group.rows.map(({ row, seats: rowSeats }) => (
            <div className="seat-row" key={`${group.section}-${row}`}>
              <span className="seat-row__label">{row}</span>
              <div className="seat-row__seats">
                {rowSeats.map((seat) => (
                  <SeatButton
                    key={seat.id}
                    id={seat.id}
                    label={`${seat.section}${seat.row}-${String(seat.number).padStart(2, "0")}`}
                    section={seat.section}
                    status={seat.status}
                    priceCents={seat.price_cents}
                    selected={selected.has(seat.id)}
                    disabled={locked || seat.status !== "available" || selectionFull}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
