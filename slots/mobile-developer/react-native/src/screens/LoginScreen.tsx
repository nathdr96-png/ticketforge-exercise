import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AppButton } from "../components/AppButton";
import { ErrorBanner } from "../components/ErrorBanner";
import { toDisplayError, type DisplayError } from "../lib/errors";
import { useSession } from "../state/session";
import { colors, radius, space, type } from "../theme";

/**
 * Sign-in.
 *
 * A refused sign-in stays on this screen and shows the contract's error code.
 * Nothing is swallowed and nothing is retried silently: on a phone a wrong
 * password and a dead connection feel identical, so the code is what tells the
 * buyer which one it was.
 */
export function LoginScreen() {
  const { signIn, signingIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<DisplayError | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(toDisplayError(cause));
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text role="heading" style={styles.title}>
          TicketForge
        </Text>
        <Text style={styles.subtitle}>Sign in to browse events and buy seats.</Text>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="login-email"
            accessibilityLabel="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            returnKeyType="next"
            placeholder="buyer01@ticketforge.test"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            testID="login-password"
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            placeholder="password123"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </View>

        <AppButton
          testID="login-submit"
          label={signingIn ? "Signing in…" : "Sign in"}
          variant="primary"
          disabled={signingIn}
          onPress={() => void submit()}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, alignItems: "center", justifyContent: "center", flexGrow: 1 },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    gap: space.md,
  },
  title: { fontSize: type.title, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: type.body, color: colors.textMuted, marginBottom: space.sm },
  field: { gap: space.xs },
  label: { fontSize: type.caption, fontWeight: "600", color: colors.textMuted },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: type.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
