/**
 * Navigation: a deep-link path and a subscribable current route.
 *
 * TicketForge's screens are addressable — `ticketforge://events/event_arena_2000`
 * on a device, `#/events/event_arena_2000` in a browser — because that is what
 * a ticket link in an email has to open. `parsePath` and `pathFor` are the pure
 * half of that and know nothing about either platform.
 *
 * The platform half is `subscribe()`/`navigate()`. On the web the fragment IS
 * the route store: reading it means every screen survives a refresh and a
 * pasted link lands on the right screen with no server rewrite rules. On a
 * device the same store would be driven by `Linking.addEventListener("url")`
 * and an in-memory stack; the three functions below are the seam where that
 * swap happens, which is why no screen touches a URL directly.
 *
 * This is deliberately not `@react-navigation/native`: five screens and one
 * parameter do not justify a navigator, a gesture handler and a reanimated
 * dependency against the bundle budget in `contract/perf-budget.yaml`.
 */

import { Platform } from "react-native";
import { useEffect, useState } from "react";

export type Route =
  | { name: "login" }
  | { name: "events" }
  | { name: "event"; eventId: string }
  | { name: "orders" }
  | { name: "reports" };

/** `"/events/event_arena_2000"` -> `{ name: "event", eventId: … }`. */
export function parsePath(path: string): Route {
  const segments = path
    .replace(/^#/, "")
    .split("/")
    .filter((segment) => segment.length > 0);

  switch (segments[0]) {
    case "events":
      return segments[1]
        ? { name: "event", eventId: decodeURIComponent(segments[1]) }
        : { name: "events" };
    case "orders":
      return { name: "orders" };
    case "reports":
      return { name: "reports" };
    case "login":
      return { name: "login" };
    default:
      return { name: "events" };
  }
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case "login":
      return "/login";
    case "events":
      return "/events";
    case "event":
      return `/events/${encodeURIComponent(route.eventId)}`;
    case "orders":
      return "/orders";
    case "reports":
      return "/reports";
  }
}

/* --------------------------------------------------------------- platform */

function currentPath(): string {
  if (Platform.OS !== "web") return "/events";
  return globalThis.location?.hash?.replace(/^#/, "") ?? "/events";
}

export function navigate(route: Route): void {
  if (Platform.OS !== "web") return;
  const next = `#${pathFor(route)}`;
  if (globalThis.location && globalThis.location.hash !== next) {
    globalThis.location.hash = next;
  }
}

function subscribe(listener: () => void): () => void {
  if (Platform.OS !== "web") return () => undefined;
  globalThis.addEventListener?.("hashchange", listener);
  return () => globalThis.removeEventListener?.("hashchange", listener);
}

/** The route the app is on, re-rendering the tree when it changes. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath(currentPath()));
  useEffect(() => subscribe(() => setRoute(parsePath(currentPath()))), []);
  return route;
}
