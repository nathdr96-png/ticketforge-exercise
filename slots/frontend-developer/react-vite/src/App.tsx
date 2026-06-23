import { useEffect } from "react";
import { navigate, useRoute } from "./lib/router";
import { SessionProvider, useSession } from "./state/session";
import { EventPage } from "./components/EventPage";
import { EventsPage } from "./components/EventsPage";
import { LoginPage } from "./components/LoginPage";
import { Nav } from "./components/Nav";
import { OrdersPage } from "./components/OrdersPage";
import { ReportsPage } from "./components/ReportsPage";

function Routes(): JSX.Element {
  const route = useRoute();
  const { token, user } = useSession();

  // Send an authenticated visitor who lands on #/login (or /) to the events list.
  useEffect(() => {
    if (token && route.name === "login") navigate({ name: "events" });
  }, [token, route.name]);

  if (!token || !user) return <LoginPage />;

  return (
    <div className="shell">
      <Nav route={route} />
      {route.name === "event" ? (
        <EventPage eventId={route.eventId} />
      ) : route.name === "orders" ? (
        <OrdersPage />
      ) : route.name === "reports" ? (
        /* Buyers can only land here by URL; the page renders the API's 403, not numbers. */
        <ReportsPage />
      ) : (
        <EventsPage />
      )}
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
