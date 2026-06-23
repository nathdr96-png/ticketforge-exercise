/**
 * One place for colour, spacing and type scale, so no `StyleSheet.create` in a
 * screen has to invent a hex value. Values are device-independent pixels.
 */

export const colors = {
  background: "#f4f5f7",
  surface: "#ffffff",
  border: "#d9dde3",
  text: "#14181f",
  textMuted: "#5c6673",
  primary: "#1f5fd6",
  primaryText: "#ffffff",
  danger: "#b3261e",
  dangerSurface: "#fdecea",
  available: "#2f9e5e",
  availableSurface: "#e6f6ec",
  held: "#c98400",
  heldSurface: "#fdf3e0",
  sold: "#9aa3ad",
  soldSurface: "#eceef1",
  selected: "#1f5fd6",
  selectedSurface: "#e4edfc",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
} as const;

export const type = {
  title: 22,
  heading: 17,
  body: 14,
  caption: 12,
  micro: 10,
} as const;

/** Seat tile geometry. The seat map's row height is derived from it. */
export const seatSize = {
  width: 44,
  height: 34,
  gap: 3,
} as const;

export const SEAT_ROW_HEIGHT = seatSize.height + seatSize.gap * 2 + 20;
