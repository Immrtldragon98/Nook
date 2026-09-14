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
  const [mode, setMode] = useState<"in" | "up">("up");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("prefer_not_to_say");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(mode: "in" | "up") {
    if (password.length < 8 || (mode === "in" ? !identifier.trim() : !email.trim()))
      return Alert.alert(
        "Check details",
        "Use a valid email and a password of at least 8 characters.",
      );
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
        <Text style={s.brand}>Nook</Text>
        <Text style={s.title}>{mode === "up" ? "Create your Nook." : "Welcome back."}</Text>
        <Text style={s.copy}>
          {mode === "up"
            ? "Find friends through real activities—not swiping. Your phone number stays private."
            : "Sign in to see your groups, plans and connections on this phone."}
        </Text>
        <View style={s.tabs}>
          <TouchableOpacity onPress={() => setMode("up")} style={[s.tab, mode === "up" && s.tabActive]}>
            <Text style={[s.tabText, mode === "up" && s.tabTextActive]}>Create account</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode("in")} style={[s.tab, mode === "in" && s.tabActive]}>
            <Text style={[s.tabText, mode === "in" && s.tabTextActive]}>Sign in</Text>
          </TouchableOpacity>
        </View>
        {mode === "up" ? <>
          <Text style={s.fieldLabel}>Username</Text>
          <TextInput value={username} onChangeText={setUsername} autoCapitalize="none"
            placeholder="Username (example: Logan)" style={s.input} />
          <Text style={s.fieldLabel}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none"
            keyboardType="email-address" placeholder="Email" style={s.input} />
          <Text style={s.fieldLabel}>Age</Text>
          <TextInput value={age} onChangeText={setAge} keyboardType="number-pad"
            placeholder="Age (18+)" style={s.input} />
          <Text style={s.fieldLabel}>Gender</Text>
          <View style={s.genderRow}>
            {[['woman','Woman'],['man','Man'],['non_binary','Non-binary'],['prefer_not_to_say','Skip']].map(([value,label]) => (
              <TouchableOpacity key={value} onPress={() => setGender(value)}
                style={[s.genderChip, gender === value && s.genderActive]}>
                <Text style={[s.genderText, gender === value && s.genderTextActive]}>{value === "prefer_not_to_say" ? "Prefer not to say" : label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </> : <><Text style={s.fieldLabel}>Username or email</Text><TextInput value={identifier} onChangeText={setIdentifier} autoCapitalize="none"
          placeholder="Logan or name@email.com" style={s.input} /></>}
        <View style={s.passwordLabelRow}><Text style={s.fieldLabel}>Password</Text><TouchableOpacity onPress={() => setShowPassword(!showPassword)}><Text style={s.showText}>{showPassword ? "Hide" : "Show"}</Text></TouchableOpacity></View>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          placeholder="Password (8+ characters)"
          style={s.input}
        />
        <TouchableOpacity
          disabled={busy}
          onPress={() => submit(mode)}
          style={s.primary}
        >
          <Text style={s.primaryText}>
            {busy ? "Please wait…" : mode === "up" ? "Create my account" : "Sign in"}
          </Text>
        </TouchableOpacity>
        <Text style={s.note}>
          {mode === "up" ? "Nook is for adults 18+. We’ll email you a verification link." : "Use your username or email and registered password."}
        </Text>
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
  fieldLabel: { color: "#4F5955", fontWeight: "800", fontSize: 12, marginBottom: 7 },
  passwordLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  showText: { color: "#247064", fontWeight: "900", fontSize: 12, marginBottom: 7 },
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
});
