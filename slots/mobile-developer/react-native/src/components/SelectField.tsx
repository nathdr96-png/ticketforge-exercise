import { Picker } from "@react-native-picker/picker";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius, space, type } from "../theme";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A labelled picker.
 *
 * `@react-native-picker/picker` is the community picker an RN app uses now that
 * `Picker` has left core. Its web implementation renders a real `<select>` with
 * real `<option>` children, which matters here for a reason beyond looks: the
 * conformance suite drives `filter-section`, `filter-availability` and
 * `events-page-size` with Playwright's `selectOption`, and that only works
 * against a genuine form control. A `Pressable` that opens a custom sheet would
 * look more "app-like" and be undrivable.
 *
 * The `testID` goes on the picker itself, so the id in contract/testids.md
 * lands on the control whose value the suite sets — not on the wrapper.
 */
export function SelectField({
  label,
  testID,
  value,
  options,
  onChange,
}: {
  label: string;
  testID: string;
  value: string;
  options: readonly SelectOption[];
  onChange(next: string): void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Picker
        testID={testID}
        accessibilityLabel={label}
        selectedValue={value}
        onValueChange={(next) => onChange(String(next))}
        style={styles.picker}
      >
        {options.map((option) => (
          <Picker.Item key={option.value} label={option.label} value={option.value} />
        ))}
      </Picker>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  label: {
    fontSize: type.micro,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  picker: {
    minHeight: 34,
    minWidth: 128,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: type.body,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
});
