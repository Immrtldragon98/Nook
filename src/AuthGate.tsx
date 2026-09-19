import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    async function acceptEmailLink(url: string | null) {
      if (!url) return;
      const fragment = url.split("#")[1] ?? url.split("?")[1] ?? "";
      const params = new URLSearchParams(fragment);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token)
        await supabase.auth.setSession({ access_token, refresh_token });
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    Linking.getInitialURL().then(acceptEmailLink);
    const link = Linking.addEventListener("url", ({ url }) => {
      acceptEmailLink(url).catch(() => Alert.alert("Confirmation failed", "Please open the newest confirmation email."));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next),
    );
    return () => { data.subscription.unsubscribe(); link.remove(); };
  }, []);
  if (session === undefined) return <Screen title="Opening Nook…" />;
  if (!session) return <Auth />;
  return <>{children}</>;
}
function Auth() {
  const [mode, setMode] = useState<"in" | "up" | "recover">("in");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("prefer_not_to_say");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRules = {
    length: password.length >= 10,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const strongPassword = Object.values(passwordRules).every(Boolean);
  async function sendRecovery() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return Alert.alert("Check email", "Enter the email address for your Nook account.");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: "nook://auth/callback",
    });
    setBusy(false);
    if (error) Alert.alert("Could not send reset email", "Please wait a minute and try again.");
    else Alert.alert("Check your email", "Open the reset link on this phone, then choose a new password in Profile → Account & privacy.");
  }
  async function submit(mode: "in" | "up") {
    if (!password || (mode === "in" ? !identifier.trim() : !email.trim()))
      return Alert.alert(
        "Check details",
        "Enter your username or email and password.",
      );
    if (mode === "up" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return Alert.alert("Check email", "Enter a complete email address, such as name@email.com.");
    if (mode === "up" && !strongPassword)
      return Alert.alert("Choose a stronger password", "Use 10+ characters with uppercase, lowercase, a number and a symbol.");
    if (mode === "up" && !/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(username))
      return Alert.alert("Check username", "Use 3–20 letters, numbers or underscores; start with a letter.");
    const declaredAge = Number(age);
    if (mode === "up" && (!Number.isInteger(declaredAge) || declaredAge < 18 || declaredAge > 100))
      return Alert.alert("Check age", "Nook currently supports adults aged 18–100.");
    setBusy(true);
    let error: any = null;
    if (mode === "in") {
      const result = await supabase.functions.invoke("username-login", {
        body: { identifier: identifier.trim(), password },
      });
      error = result.error ?? (result.data?.error ? new Error(result.data.error) : null);
      if (!error && result.data?.access_token)
        ({ error } = await supabase.auth.setSession({
          access_token: result.data.access_token,
          refresh_token: result.data.refresh_token,
        }));
    } else {
      ({ error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: "nook://auth/callback",
          data: { username: username.trim(), gender, declared_age: declaredAge },
        },
      }));
    }
    setBusy(false);
    if (error) Alert.alert("Could not continue", error.message);
    else if (mode === "up")
      Alert.alert(
        "Check your email",
        "Confirm your address, then return to Nook.",
      );
  }
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <View style={s.brandRow}><View style={s.brandMark}><Text style={s.brandMarkText}>n</Text></View><Text style={s.brand}>Nook</Text></View>
        <Text style={s.title}>{mode === "up" ? "Create your Nook." : mode === "recover" ? "Reset your password." : "Welcome back."}</Text>
        <Text style={s.copy}>
          {mode === "up"
            ? "Find friends through real activities—not swiping. Your phone number stays private."
            : mode === "recover" ? "We’ll send a private reset link to your registered email."
            : "Sign in to see your groups, plans and connections on this phone."}
        </Text>
        {mode !== "recover" && <View style={s.tabs}>
          <TouchableOpacity onPress={() => setMode("up")} style={[s.tab, mode === "up" && s.tabActive]}>
            <Text style={[s.tabText, mode === "up" && s.tabTextActive]}>Create account</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("in")} style={[s.tab, mode === "in" && s.tabActive]}>
            <Text style={[s.tabText, mode === "in" && s.tabTextActive]}>Sign in</Text>
          </TouchableOpacity>
        </View>}
        {mode === "recover" ? <>
          <View style={s.fieldHeading}><Text style={s.fieldIcon}>✉</Text><View><Text style={s.fieldLabel}>Registered email address</Text><Text style={s.fieldHelp}>We never show whether this email has an account</Text></View></View>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="name@email.com" style={s.input} />
        </> : mode === "up" ? <>
          <View style={s.fieldHeading}><Text style={s.fieldIcon}>@</Text><View><Text style={s.fieldLabel}>Username</Text><Text style={s.fieldHelp}>Your public Nook name</Text></View></View>
          <TextInput value={username} onChangeText={setUsername} autoCapitalize="none"
            placeholder="Example: Logan" style={s.input} />
          <View style={s.fieldHeading}><Text style={s.fieldIcon}>✉</Text><View><Text style={s.fieldLabel}>Email address</Text><Text style={s.fieldHelp}>Used for verification and recovery</Text></View></View>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none"
            keyboardType="email-address" placeholder="name@email.com" style={s.input} />
          <View style={s.fieldHeading}><Text style={s.fieldIcon}>18+</Text><View><Text style={s.fieldLabel}>Age</Text><Text style={s.fieldHelp}>Nook is currently for adults</Text></View></View>
          <TextInput value={age} onChangeText={setAge} keyboardType="number-pad"
            placeholder="Enter your age" style={s.input} />
          <Text style={s.fieldLabel}>Gender</Text>
          <View style={s.genderRow}>
            {[['woman','Woman'],['man','Man'],['non_binary','Non-binary'],['prefer_not_to_say','Skip']].map(([value,label]) => (
              <TouchableOpacity key={value} onPress={() => setGender(value)}
                style={[s.genderChip, gender === value && s.genderActive]}>
                <Text style={[s.genderText, gender === value && s.genderTextActive]}>{value === "prefer_not_to_say" ? "Prefer not to say" : label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </> : <><View style={s.fieldHeading}><Text style={s.fieldIcon}>@</Text><View><Text style={s.fieldLabel}>Username or email</Text><Text style={s.fieldHelp}>Either one works</Text></View></View><TextInput value={identifier} onChangeText={setIdentifier} autoCapitalize="none"
          placeholder="Logan or name@email.com" style={s.input} /></>}
        {mode !== "recover" && <><View style={s.passwordLabelRow}><View style={s.fieldHeading}><Text style={s.fieldIcon}>●</Text><View><Text style={s.fieldLabel}>Password</Text><Text style={s.fieldHelp}>{mode === "up" ? "Create a strong, unique password" : "Your registered Nook password"}</Text></View></View><TouchableOpacity onPress={() => setShowPassword(!showPassword)}><Text style={s.showText}>{showPassword ? "Hide" : "Show"}</Text></TouchableOpacity></View>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          placeholder={mode === "up" ? "10+ characters" : "Enter your password"}
          style={s.input}
        />
        {mode === "up" && <View style={s.passwordRules}>
          {[
            [passwordRules.length, "10+ characters"],
            [passwordRules.upper && passwordRules.lower, "Uppercase and lowercase"],
            [passwordRules.number, "At least one number"],
            [passwordRules.symbol, "At least one symbol"],
          ].map(([passed, label]) => <View key={String(label)} style={s.ruleRow}>
            <Text style={[s.ruleMark, passed && s.rulePassed]}>{passed ? "✓" : "○"}</Text>
            <Text style={[s.ruleText, passed && s.ruleTextPassed]}>{label}</Text>
          </View>)}
        </View>}</>}
        <TouchableOpacity
          disabled={busy}
          onPress={() => mode === "recover" ? sendRecovery() : submit(mode)}
          style={s.primary}
        >
          <Text style={s.primaryText}>
            {busy ? "Please wait…" : mode === "up" ? "Create my account" : mode === "recover" ? "Send reset link" : "Sign in"}
          </Text>
        </TouchableOpacity>
        <Text style={s.note}>
          {mode === "up" ? "Nook is for adults 18+. We’ll email you a verification link." : mode === "recover" ? "The link opens Nook securely on this phone." : "Use your username or email and registered password."}
        </Text>
        {mode === "in" && <TouchableOpacity onPress={() => setMode("recover")} style={s.recoveryButton}><Text style={s.recoveryText}>Forgot password?</Text></TouchableOpacity>}
        {mode === "recover" && <TouchableOpacity onPress={() => setMode("in")} style={s.recoveryButton}><Text style={s.recoveryText}>Back to sign in</Text></TouchableOpacity>}
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}
function Screen({ title }: { title: string }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.card}>
        <Text style={s.brand}>Nook</Text>
        <Text style={s.title}>{title}</Text>
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8F6EF", justifyContent: "center" },
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: 18 },
  card: { margin: 22, padding: 24, borderRadius: 26, backgroundColor: "#FFF" },
  brand: {
    fontSize: 16,
    fontWeight: "900",
    color: "#247064",
    letterSpacing: 1,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: { width: 34, height: 34, borderRadius: 11, backgroundColor: "#7EA6FA", alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: "#FFF", fontWeight: "900", fontSize: 23 },
  title: {
    fontSize: 31,
    lineHeight: 37,
    fontWeight: "900",
    color: "#17211F",
    marginTop: 12,
  },
  copy: { fontSize: 15, lineHeight: 22, color: "#68716D", marginVertical: 18 },
  tabs: { flexDirection: "row", backgroundColor: "#F1EFE8", borderRadius: 14, padding: 4, marginBottom: 16 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 11 },
  tabActive: { backgroundColor: "#247064" },
  tabText: { color: "#68716D", fontWeight: "800" },
  tabTextActive: { color: "#FFF" },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: "#DDDAD0",
    borderRadius: 15,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  fieldHeading: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 7 },
  fieldIcon: { width: 27, height: 27, borderRadius: 9, textAlign: "center", textAlignVertical: "center", backgroundColor: "#EEF2FF", color: "#5769B3", fontSize: 10, fontWeight: "900" },
  fieldLabel: { color: "#27312E", fontWeight: "900", fontSize: 13 },
  fieldHelp: { color: "#87908C", fontWeight: "600", fontSize: 10, marginTop: 1 },
  passwordLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  showText: { color: "#247064", fontWeight: "900", fontSize: 12, marginBottom: 7 },
  passwordRules: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 5, width: "47%" },
  ruleMark: { color: "#A2A9A6", fontWeight: "900", fontSize: 13 },
  rulePassed: { color: "#247064" },
  ruleText: { color: "#7B8581", fontSize: 10, fontWeight: "700" },
  ruleTextPassed: { color: "#247064" },
  genderRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 12 },
  genderChip: { borderWidth: 1, borderColor: "#DDDAD0", borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  genderActive: { backgroundColor: "#E3F2EC", borderColor: "#247064" },
  genderText: { color: "#68716D", fontSize: 12, fontWeight: "700" },
  genderTextActive: { color: "#247064" },
  primary: {
    backgroundColor: "#247064",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
  },
  primaryText: { color: "#FFF", fontWeight: "900" },
  note: { color: "#68716D", fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 12 },
  recoveryButton: { alignSelf: "center", paddingVertical: 14 },
  recoveryText: { color: "#247064", fontWeight: "900", fontSize: 13 },
});
