/**
 * Minimal hash router. Hash routing keeps the app deployable as plain static
 * files behind any server (nginx, `vite preview`, a CDN) with no rewrite rules,
 * and costs no dependency weight against the bundle budget.
 */

import { useEffect, useState } from "react";

export type Route =
  | { name: "login" }
  | { name: "events" }
  | { name: "event"; eventId: string }
  | { name: "orders" }
  | { name: "reports" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "events" && parts[1]) return { name: "event", eventId: decodeURIComponent(parts[1]) };
  if (parts[0] === "events") return { name: "events" };
  if (parts[0] === "orders") return { name: "orders" };
  if (parts[0] === "reports") return { name: "reports" };
  if (parts[0] === "login") return { name: "login" };
  return { name: "events" };
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

export function navigate(route: Route): void {
  const href = hrefFor(route);
  if (window.location.hash !== href) window.location.hash = href;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
