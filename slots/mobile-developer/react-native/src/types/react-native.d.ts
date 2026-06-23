/**
 * The React Native API surface this app uses, declared by hand.
 *
 * WHY THIS FILE EXISTS. `react-native-web` ships no TypeScript types, and the
 * usual remedy — adding the `react-native` package as a dev dependency purely
 * for its `.d.ts` files — drags ~100 MB of Android/iOS toolchain into a build
 * that never touches either. So the surface is declared here instead, against
 * the public React Native API, and `tsc --noEmit` (`make lint`) checks every
 * call against it.
 *
 * It is deliberately narrow: if a component or prop is not used by this app, it
 * is not declared. Adding a primitive means adding it here first, which is the
 * point — the app cannot quietly start depending on something that only exists
 * on one platform.
 *
 * `dataSet` is the one non-core prop. React Native has no notion of HTML data
 * attributes; `react-native-web` maps `dataSet={{ seatId }}` to
 * `data-seat-id="…"`, which is how this app satisfies the `data-*` half of
 * contract/testids.md. On a device it is inert, which is exactly right: it is
 * test metadata, not behaviour.
 */

declare module "react-native" {
  import type * as React from "react";

  /* ------------------------------------------------------------------ styles */

  export type ColorValue = string;
  export type DimensionValue = number | `${number}%` | "auto";

  export interface FlexStyle {
    alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
    alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
    flex?: number;
    flexBasis?: DimensionValue;
    flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
    flexGrow?: number;
    flexShrink?: number;
    flexWrap?: "wrap" | "nowrap" | "wrap-reverse";
    justifyContent?:
      | "flex-start"
      | "flex-end"
      | "center"
      | "space-between"
      | "space-around"
      | "space-evenly";
    gap?: number;
    rowGap?: number;
    columnGap?: number;
    height?: DimensionValue;
    width?: DimensionValue;
    maxHeight?: DimensionValue;
    maxWidth?: DimensionValue;
    minHeight?: DimensionValue;
    minWidth?: DimensionValue;
    margin?: DimensionValue;
    marginBottom?: DimensionValue;
    marginHorizontal?: DimensionValue;
    marginLeft?: DimensionValue;
    marginRight?: DimensionValue;
    marginTop?: DimensionValue;
    marginVertical?: DimensionValue;
    padding?: DimensionValue;
    paddingBottom?: DimensionValue;
    paddingHorizontal?: DimensionValue;
    paddingLeft?: DimensionValue;
    paddingRight?: DimensionValue;
    paddingTop?: DimensionValue;
    paddingVertical?: DimensionValue;
    overflow?: "visible" | "hidden" | "scroll";
    position?: "absolute" | "relative" | "static";
    bottom?: DimensionValue;
    left?: DimensionValue;
    right?: DimensionValue;
    top?: DimensionValue;
  }

  export interface ViewStyle extends FlexStyle {
    backgroundColor?: ColorValue;
    borderBottomColor?: ColorValue;
    borderBottomLeftRadius?: number;
    borderBottomRightRadius?: number;
    borderBottomWidth?: number;
    borderColor?: ColorValue;
    borderLeftColor?: ColorValue;
    borderLeftWidth?: number;
    borderRadius?: number;
    borderRightColor?: ColorValue;
    borderRightWidth?: number;
    borderStyle?: "solid" | "dotted" | "dashed";
    borderTopColor?: ColorValue;
    borderTopLeftRadius?: number;
    borderTopRightRadius?: number;
    borderTopWidth?: number;
    borderWidth?: number;
    opacity?: number;
    elevation?: number;
    shadowColor?: ColorValue;
    shadowOffset?: { width: number; height: number };
    shadowOpacity?: number;
    shadowRadius?: number;
  }

  export interface TextStyle extends ViewStyle {
    color?: ColorValue;
    fontFamily?: string;
    fontSize?: number;
    fontStyle?: "normal" | "italic";
    fontVariant?: string[];
    fontWeight?:
      | "normal"
      | "bold"
      | "100"
      | "200"
      | "300"
      | "400"
      | "500"
      | "600"
      | "700"
      | "800"
      | "900";
    letterSpacing?: number;
    lineHeight?: number;
    textAlign?: "auto" | "left" | "right" | "center" | "justify";
    textDecorationLine?: "none" | "underline" | "line-through" | "underline line-through";
    textTransform?: "none" | "capitalize" | "uppercase" | "lowercase";
  }

  export type StyleProp<T> = T | null | undefined | false | readonly StyleProp<T>[];

  export namespace StyleSheet {
    function create<T extends { [key: string]: ViewStyle | TextStyle }>(styles: T): T;
    function flatten<T>(style?: StyleProp<T>): T;
    const absoluteFill: ViewStyle;
    const hairlineWidth: number;
  }

  /* ------------------------------------------------------------------- props */

  /** react-native-web's extension: rendered as `data-*` attributes on the web. */
  export type DataSet = Readonly<Record<string, string | number | boolean | undefined>>;

  export interface AccessibilityProps {
    accessibilityLabel?: string;
    accessibilityHint?: string;
    accessibilityState?: {
      disabled?: boolean;
      selected?: boolean;
      checked?: boolean | "mixed";
      busy?: boolean;
      expanded?: boolean;
    };
    accessible?: boolean;
    /**
     * `role` is the modern spelling (React Native 0.71+) and is what
     * react-native-web maps onto a semantic DOM element: `role="button"` renders
     * a real `<button>`, which is what makes `toBeDisabled()` meaningful.
     */
    role?:
      | "alert"
      | "button"
      | "heading"
      | "img"
      | "link"
      | "list"
      | "listitem"
      | "none"
      | "progressbar"
      | "region"
      | "status"
      | "summary"
      | "timer";
    "aria-live"?: "assertive" | "off" | "polite";
  }

  export interface ViewProps extends AccessibilityProps {
    children?: React.ReactNode;
    dataSet?: DataSet;
    nativeID?: string;
    pointerEvents?: "auto" | "box-none" | "box-only" | "none";
    style?: StyleProp<ViewStyle>;
    testID?: string;
  }

  export interface TextProps extends AccessibilityProps {
    children?: React.ReactNode;
    dataSet?: DataSet;
    numberOfLines?: number;
    onPress?: () => void;
    selectable?: boolean;
    style?: StyleProp<TextStyle>;
    testID?: string;
  }

  export interface TargetedEvent {
    target: number;
  }

  export interface NativeSyntheticEvent<T> {
    nativeEvent: T;
  }

  export interface PressableStateCallbackType {
    pressed: boolean;
    hovered?: boolean;
    focused?: boolean;
  }

  export interface PressableProps extends AccessibilityProps {
    children?: React.ReactNode | ((state: PressableStateCallbackType) => React.ReactNode);
    dataSet?: DataSet;
    disabled?: boolean;
    hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
    onLongPress?: () => void;
    onPress?: () => void;
    style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
    testID?: string;
  }

  export interface TextInputProps extends AccessibilityProps {
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    autoComplete?: string;
    autoCorrect?: boolean;
    autoFocus?: boolean;
    dataSet?: DataSet;
    editable?: boolean;
    inputMode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
    keyboardType?: "default" | "email-address" | "numeric" | "phone-pad" | "url";
    onChangeText?: (text: string) => void;
    onSubmitEditing?: () => void;
    placeholder?: string;
    placeholderTextColor?: ColorValue;
    returnKeyType?: "done" | "go" | "next" | "search" | "send";
    secureTextEntry?: boolean;
    selectTextOnFocus?: boolean;
    style?: StyleProp<TextStyle>;
    testID?: string;
    value?: string;
  }

  export interface ScrollViewProps extends ViewProps {
    contentContainerStyle?: StyleProp<ViewStyle>;
    horizontal?: boolean;
    keyboardShouldPersistTaps?: "always" | "never" | "handled";
    scrollEnabled?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    showsVerticalScrollIndicator?: boolean;
  }

  export interface ListRenderItemInfo<ItemT> {
    item: ItemT;
    index: number;
  }

  export type ListRenderItem<ItemT> = (
    info: ListRenderItemInfo<ItemT>,
  ) => React.ReactElement | null;

  export interface FlatListProps<ItemT> extends ScrollViewProps {
    ListEmptyComponent?: React.ReactElement | null;
    ListFooterComponent?: React.ReactElement | null;
    ListHeaderComponent?: React.ReactElement | null;
    data: readonly ItemT[] | null | undefined;
    /** Opaque value re-rendered rows depend on; see components/SeatMap.tsx. */
    extraData?: unknown;
    getItemLayout?: (
      data: readonly ItemT[] | null | undefined,
      index: number,
    ) => { length: number; offset: number; index: number };
    initialNumToRender?: number;
    keyExtractor?: (item: ItemT, index: number) => string;
    maxToRenderPerBatch?: number;
    removeClippedSubviews?: boolean;
    renderItem: ListRenderItem<ItemT>;
    updateCellsBatchingPeriod?: number;
    windowSize?: number;
  }

  /* -------------------------------------------------------------- components */

  export const View: React.ComponentType<ViewProps>;
  export const Text: React.ComponentType<TextProps>;
  export const Pressable: React.ComponentType<PressableProps>;
  export const TextInput: React.ComponentType<TextInputProps>;
  export const ScrollView: React.ComponentType<ScrollViewProps>;
  export const ActivityIndicator: React.ComponentType<
    ViewProps & { color?: ColorValue; size?: "small" | "large" | number }
  >;
  export class FlatList<ItemT = unknown> extends React.Component<FlatListProps<ItemT>> {}

  /* ------------------------------------------------------------------ system */

  export const Platform: {
    OS: "ios" | "android" | "web" | "windows" | "macos";
    select<T>(spec: { ios?: T; android?: T; web?: T; native?: T; default?: T }): T;
  };

  export function useWindowDimensions(): {
    width: number;
    height: number;
    scale: number;
    fontScale: number;
  };

  export const AppRegistry: {
    registerComponent(appKey: string, componentProvider: () => React.ComponentType<object>): void;
    runApplication(appKey: string, appParameters: { rootTag: unknown; initialProps?: object }): void;
  };

  /** Declared because @react-native-picker/picker's own types import it. */
  export function processColor(color?: ColorValue): number | null | undefined;
}
