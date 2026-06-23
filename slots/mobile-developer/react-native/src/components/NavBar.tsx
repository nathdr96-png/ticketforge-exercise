import { Pressable, StyleSheet, Text, View } from "react-native";

import { navigate, type Route } from "../lib/navigation";
import { useSession } from "../state/session";
import { colors, radius, space, type } from "../theme";

/**
 * The app's tab bar.
 *
 * `nav-reports` renders for an `organizer` or `admin` only. That is a courtesy,
 * not the control: the Revenue screen is reachable by deep link for anybody who
 * has the URL, and what refuses them there is the API's
 * `INSUFFICIENT_PERMISSION` rather than a hidden tab. A client that only hides
 * the tab has not restricted anything.
 */
export function NavBar({ route }: { route: Route }) {
  const { user, signOut, canSeeReports } = useSession();
  const active = route.name === "event" ? "events" : route.name;

  return (
    <View style={styles.bar}>
      <View style={styles.tabs}>
        <Tab
          testID="nav-events"
          label="Events"
          active={active === "events"}
          onPress={() => navigate({ name: "events" })}
        />
        <Tab
          testID="nav-orders"
          label="Orders"
          active={active === "orders"}
          onPress={() => navigate({ name: "orders" })}
        />
        {canSeeReports ? (
          <Tab
            testID="nav-reports"
            label="Revenue"
            active={active === "reports"}
            onPress={() => navigate({ name: "reports" })}
          />
        ) : null}
      </View>
      <View style={styles.account}>
        <Text testID="current-user" dataSet={{ role: user?.role }} style={styles.email}>
          {user?.email}
        </Text>
        <Pressable testID="sign-out" role="button" onPress={signOut} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Tab({
  testID,
  label,
  active,
  onPress,
}: {
  testID: string;
  label: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active ? styles.tabActive : null]}
    >
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabs: { flexDirection: "row", gap: space.xs },
  tab: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  tabActive: { backgroundColor: colors.selectedSurface },
  tabLabel: { fontSize: type.body, fontWeight: "600", color: colors.textMuted },
  tabLabelActive: { color: colors.primary },
  account: { flexDirection: "row", alignItems: "center", gap: space.md },
  email: { fontSize: type.caption, color: colors.textMuted },
  signOut: { fontSize: type.caption, fontWeight: "600", color: colors.primary },
});
