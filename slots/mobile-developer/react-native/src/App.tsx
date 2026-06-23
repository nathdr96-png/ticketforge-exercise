import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { NavBar } from "./components/NavBar";
import { navigate, useRoute } from "./lib/navigation";
import { EventScreen } from "./screens/EventScreen";
import { EventsScreen } from "./screens/EventsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { OrdersScreen } from "./screens/OrdersScreen";
import { ReportsScreen } from "./screens/ReportsScreen";
import { SessionProvider, useSession } from "./state/session";
import { colors } from "./theme";

/**
 * Auth gate plus one mounted screen.
 *
 * Exactly one screen is mounted at a time, which is how the app can promise at
 * most one `error-banner` on screen: a stacked navigator that keeps the previous
 * screen alive would leave two banners addressable at once.
 */
function Screens() {
  const route = useRoute();
  const { token, user } = useSession();

  useEffect(() => {
    // Somebody who signs in while sitting on the sign-in deep link belongs on
    // the events list, not on a screen that no longer applies to them.
    if (token && route.name === "login") navigate({ name: "events" });
  }, [token, route.name]);

  if (!token || !user) return <LoginScreen />;

  return (
    <View style={styles.shell}>
      <NavBar route={route} />
      {route.name === "event" ? (
        <EventScreen eventId={route.eventId} />
      ) : route.name === "orders" ? (
        <OrdersScreen />
      ) : route.name === "reports" ? (
        /* Reachable by deep link for anyone; the API's 403 is the refusal. */
        <ReportsScreen />
      ) : (
        <EventsScreen />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Screens />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
});
