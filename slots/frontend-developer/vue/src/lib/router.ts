/**
 * A hash router in forty lines, deliberately not vue-router.
 *
 * Hash routing makes the built app deployable as plain static files behind any
 * server — `vite preview`, nginx, a CDN — with no rewrite rules, and it costs
 * nothing against the 250 kB gzipped budget in contract/perf-budget.yaml. The
 * current route is a single module-scope ref, so every component that reads it
 * re-renders on `hashchange` without plumbing.
 */

import { shallowRef, type Ref } from "vue";

export type Route =
  | { name: "login" }
  | { name: "events" }
  | { name: "event"; eventId: string }
  | { name: "orders" }
  | { name: "reports" };

export function parseHash(hash: string): Route {
  const segments = hash
    .replace(/^#/, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment));

  switch (segments[0]) {
    case "events":
      return segments[1] ? { name: "event", eventId: segments[1] } : { name: "events" };
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

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "login":
      return "#/login";
    case "events":
      return "#/events";
    case "event":
      return `#/events/${encodeURIComponent(route.eventId)}`;
    case "orders":
      return "#/orders";
    case "reports":
      return "#/reports";
  }
}

const current = shallowRef<Route>(parseHash(window.location.hash));

window.addEventListener("hashchange", () => {
  current.value = parseHash(window.location.hash);
});

/** The live route. Treat it as read-only — change it through `navigate`. */
export function useRoute(): Ref<Route> {
  return current;
}

export function navigate(route: Route): void {
  const href = hrefFor(route);
  if (window.location.hash === href) return;
  window.location.hash = href;
}
