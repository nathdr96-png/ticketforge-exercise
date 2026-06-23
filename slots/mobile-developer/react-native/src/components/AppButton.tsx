import { Pressable, StyleSheet, Text } from "react-native";

import { colors, radius, space, type } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "ghost";

/**
 * The app's one tappable button.
 *
 * `role="button"` is not decoration. On a device it is what a screen reader
 * announces; on the web `react-native-web` turns it into a real `<button>`
 * element, which is what gives `disabled` its DOM meaning — a plain `View` with
 * `aria-disabled` would read as enabled to anything that asks the platform.
 * `events-prev` and `events-next` are asserted as disabled by the conformance
 * suite, so that distinction is measured.
 */
export function AppButton({
  label,
  testID,
  onPress,
  disabled = false,
  variant = "secondary",
}: {
  label: string;
  testID?: string;
  onPress(): void;
  disabled?: boolean;
  variant?: ButtonVariant;
}) {
  return (
    <Pressable
      testID={testID}
      role="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.label, variant === "primary" ? styles.labelPrimary : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.45 },
  label: { fontSize: type.body, fontWeight: "600", color: colors.text },
  labelPrimary: { color: colors.primaryText },
});
