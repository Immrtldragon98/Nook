import React from "react";
import {
  KeyboardAvoidingView, Platform, ScrollView as NativeScrollView,
  type ScrollViewProps,
} from "react-native";
import { SafeAreaView as NativeSafeAreaView, type SafeAreaViewProps } from "react-native-safe-area-context";

/** One shared phone shell: display cutouts, home indicator and form keyboard. */
export function SafeAreaView({ children, style, ...props }: SafeAreaViewProps) {
  return <NativeSafeAreaView {...props} style={[{ flex: 1 }, style]}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {children}
    </KeyboardAvoidingView>
  </NativeSafeAreaView>;
}

/** Keep form actions tappable while typing; bound reading width on larger phones. */
export function ScrollView({ horizontal, contentContainerStyle, ...props }: ScrollViewProps) {
  return <NativeScrollView keyboardShouldPersistTaps="handled"
    keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
    {...props} horizontal={horizontal}
    contentContainerStyle={[
      !horizontal && { width: "100%", maxWidth: 600, alignSelf: "center", paddingBottom: 24 },
      contentContainerStyle,
    ]} />;
}
