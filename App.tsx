import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import {
  addPendingConnection,
  addTestHostRequest,
  clearGroupReview,
  getGender,
  getModerationState,
  getProfile,
  hasConnection,
  isOwnedGroup,
  listGroups,
  listHostRequests,
  listMemberships,
  listPlans,
  migrateDatabase,
  rateGroupSafety,
  reportGroup,
  requestGroupJoin,
  restrictGroup,
  saveGroup,
  savePlan,
  saveProfile,
  setGender,
  updateHostRequest,
  type GroupMembership,
  type HostRequest,
  type LocalProfile,
  type ModerationState,
  type StoredGroup,
  type StoredPlan,
} from "./src/database";
import { QRCodeMatrix } from "./src/QRCodeMatrix";
import { AuthGate } from "./src/AuthGate";
import { cloudEnabled } from "./src/supabase";
import {
  createCloudGroup,
  currentCloudUserId,
  decideCloudMembership,
  initializeCloudIdentity,
  listCloudGroups,
  listCloudHostRequests,
  requestCloudMembership,
  submitCloudReport,
  submitCloudSafetyRating,
  watchCloudGroups,
  type CloudGroup,
  type CloudRequest,
} from "./src/cloud";

type Tab = "Discover" | "Groups" | "Create" | "Plans" | "Profile";
type Hangout = {
  id: number;
  emoji: string;
  category: string;
  title: string;
  area: string;
  time: string;
  host: string;
  spots: number;
  language: string;
  audience: string;
  safety: number;
  trustedOnly?: boolean;
};

const categories = [
  "All",
  "Women only",
  "New in city",
  "Sports",
  "Trips",
  "Food",
  "Shopping",
];
const hangouts: Hangout[] = [
  {
    id: 1,
    emoji: "🏸",
    category: "Sports",
    title: "Badminton after work",
    area: "Anna Nagar",
    time: "Today · 7:00 PM",
    host: "Arun",
    spots: 2,
    language: "English · Tamil",
    audience: "Open group",
    safety: 4.7,
  },
  {
    id: 2,
    emoji: "💃",
    category: "Women only",
    title: "Girls dance & coffee circle",
    area: "Indiranagar",
    time: "Sat · 5:30 PM",
    host: "Meera",
    spots: 4,
    language: "English · Tamil",
    audience: "Verified women only",
    safety: 4.9,
  },
  {
    id: 3,
    emoji: "🧳",
    category: "New in city",
    title: "New to Bengaluru outing",
    area: "Koramangala",
    time: "Sun · 3:00 PM",
    host: "Nikhil",
    spots: 5,
    language: "English · Malayalam",
    audience: "Singles · friendship only",
    safety: 4.6,
  },
  {
    id: 4,
    emoji: "🍜",
    category: "Food",
    title: "Restaurant hopping",
    area: "Church Street",
    time: "Sun · 6:30 PM",
    host: "Sara",
    spots: 5,
    language: "English",
    audience: "Open group",
    safety: 4.8,
  },
  {
    id: 5,
    emoji: "🛍️",
    category: "Shopping",
    title: "Weekend street shopping",
    area: "Commercial Street",
    time: "Sat · 11:00 AM",
    host: "Anu",
    spots: 3,
    language: "English · Kannada",
    audience: "Verified women only",
    safety: 4.9,
  },
  {
    id: 6,
    emoji: "🏔️",
    category: "Trips",
    title: "Nandi Hills sunrise trip",
    area: "Starts in North Bengaluru",
    time: "Sun · 4:30 AM",
    host: "Dev",
    spots: 4,
    language: "English",
    audience: "Trusted members only",
    safety: 4.8,
    trustedOnly: true,
  },
];

const USER_TRUST = {
  isAdult: true,
  isVerified: true,
  attendedPlans: 3,
  hasActiveRestriction: false,
};
const canUseTrips =
  USER_TRUST.isAdult &&
  USER_TRUST.isVerified &&
  USER_TRUST.attendedPlans >= 3 &&
  !USER_TRUST.hasActiveRestriction;

export default function App() {
  const app = (
    <SQLiteProvider databaseName="nook.db" onInit={migrateDatabase}>
      <Nook />
    </SQLiteProvider>
  );
  return cloudEnabled ? <AuthGate>{app}</AuthGate> : app;
}

function Nook() {
  const db = useSQLiteContext();
  const [tab, setTab] = useState<Tab>("Discover");
  const [category, setCategory] = useState("All");
  const [joined, setJoined] = useState<number[]>([]);
  const [localPlans, setLocalPlans] = useState<Hangout[]>([]);
  const [profile, setProfile] = useState<LocalProfile | null | undefined>(
    undefined,
  );
  async function refreshPlans() {
    const rows = await listPlans(db);
    setLocalPlans(rows.map(toHangout));
  }
  useEffect(() => {
    refreshPlans().catch(() =>
      Alert.alert(
        "Storage error",
        "Could not load plans stored on this phone.",
      ),
    );
    getProfile(db)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);
  useEffect(() => {
    if (profile && cloudEnabled)
      initializeCloudIdentity(profile).catch(() =>
        Alert.alert(
          "Profile sync pending",
          "Your local profile is safe. Nook will retry cloud sync when you open Groups.",
        ),
      );
  }, [profile]);
  const allPlans = useMemo(() => [...localPlans, ...hangouts], [localPlans]);
  const visible = useMemo(
    () =>
      category === "All"
        ? allPlans
        : allPlans.filter((h) => h.category === category),
    [category, allPlans],
  );

  if (profile === undefined)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <Text style={styles.h1}>Nook</Text>
          <Text style={styles.meta}>Opening your local profile…</Text>
        </View>
      </SafeAreaView>
    );
  if (profile === null)
    return <Onboarding onDone={async () => setProfile(await getProfile(db))} />;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8F6EF" />
      <View style={styles.shell}>
        {tab === "Discover" && (
          <Discover
            visible={visible}
            category={category}
            setCategory={setCategory}
            joined={joined}
            setJoined={setJoined}
          />
        )}
        {tab === "Groups" && <Groups profile={profile} />}
        {tab === "Create" && (
          <CreateHub
            onCreated={async () => {
              await refreshPlans();
              setTab("Discover");
            }}
          />
        )}
        {tab === "Plans" && <Plans joined={joined} />}
        {tab === "Profile" && profile && (
          <Profile profile={profile} onEdit={() => setProfile(null)} />
        )}
        <Nav active={tab} onChange={setTab} />
      </View>
    </SafeAreaView>
  );
}

function toHangout(p: StoredPlan): Hangout {
  return {
    id: 10000 + p.id,
    emoji: p.trusted_only ? "🧳" : "✨",
    category: p.category,
    title: p.title,
    area: p.area,
    time: p.starts_at,
    host: "You",
    spots: p.spots,
    language: p.language,
    audience: p.trusted_only ? "Trusted members only" : "Open group",
    safety: 5.0,
    trustedOnly: !!p.trusted_only,
  };
}

function Discover({ visible, category, setCategory, joined, setJoined }: any) {
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>BENGALURU ▾</Text>
          <Text style={styles.h1}>Find your people.</Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>Y</Text>
        </View>
      </View>
      <Text style={styles.intro}>
        Join something you already want to do—without sharing your number.
      </Text>
      <View style={styles.trustBanner}>
        <Text style={styles.trustIcon}>✓</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.trustTitle}>Trusted member</Text>
          <Text style={styles.trustCopy}>
            3 attended plans · eligible for local trips
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {categories.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => setCategory(c)}
            style={[styles.chip, c === category && styles.chipActive]}
          >
            <Text
              style={[styles.chipText, c === category && styles.chipTextActive]}
            >
              {c}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Happening nearby</Text>
        <Text style={styles.muted}>Approximate areas</Text>
      </View>
      {visible.map((h: Hangout) => {
        const isJoined = joined.includes(h.id);
        return (
          <View key={h.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.icon}>
                <Text style={styles.iconText}>{h.emoji}</Text>
              </View>
              <View style={styles.pill}>
                <Text style={styles.pillText}>
                  ★ {h.safety} · {h.spots} spots
                </Text>
              </View>
            </View>
            <Text style={styles.cardTitle}>{h.title}</Text>
            <Text style={styles.audience}>{h.audience}</Text>
            <Text style={styles.meta}>{h.time}</Text>
            <Text style={styles.meta}>
              {h.area} · {h.language}
            </Text>
            {h.trustedOnly && (
              <View style={styles.tripRules}>
                <Text style={styles.tripRulesText}>
                  🔒 Verified profile · 3 attended plans · no active safety
                  restrictions
                </Text>
              </View>
            )}
            <View style={styles.cardBottom}>
              <Text style={styles.host}>Hosted by {h.host}</Text>
              <TouchableOpacity
                disabled={isJoined}
                onPress={() => setJoined([...joined, h.id])}
                style={[
                  styles.join,
                  h.trustedOnly && styles.tripJoin,
                  isJoined && styles.joined,
                ]}
              >
                <Text style={styles.joinText}>
                  {isJoined
                    ? "Requested"
                    : h.trustedOnly
                      ? "Request trip"
                      : "Ask to join"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
      <View style={{ height: 92 }} />
    </ScrollView>
  );
}

function CreateHub({ onCreated }: { onCreated: () => Promise<void> }) {
  const db = useSQLiteContext();
  const [kind, setKind] = useState<"local" | "trip">("local");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [language, setLanguage] = useState("English");
  const [spots, setSpots] = useState("4");
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!title.trim() || !area.trim() || !startsAt.trim())
      return Alert.alert(
        "Complete the plan",
        "Add an activity, area, and date/time.",
      );
    if (kind === "trip" && !canUseTrips)
      return Alert.alert(
        "Trips are locked",
        "Complete verification and attend three local plans first.",
      );
    const count = Number(spots);
    if (!Number.isInteger(count) || count < 2 || count > 12)
      return Alert.alert("Check group size", "Choose between 2 and 12 people.");
    setSaving(true);
    try {
      await savePlan(db, {
        title,
        category: kind === "trip" ? "Trips" : "New in city",
        area,
        starts_at: startsAt,
        language,
        spots: count,
        trustedOnly: kind === "trip",
      });
      Alert.alert("Plan saved", "This plan now lives on your phone.");
      await onCreated();
    } catch {
      Alert.alert("Could not save", "Please check the details and try again.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.h1}>Make a plan</Text>
      <Text style={styles.intro}>
        Start with what you want to do—not who you want to meet.
      </Text>
      <View style={styles.kindRow}>
        <TouchableOpacity
          onPress={() => setKind("local")}
          style={[styles.kindCard, kind === "local" && styles.kindActive]}
        >
          <Text style={styles.kindEmoji}>☕</Text>
          <Text style={styles.kindTitle}>Local activity</Text>
          <Text style={styles.kindCopy}>
            Meet in a public place for a few hours.
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setKind("trip")}
          style={[styles.kindCard, kind === "trip" && styles.kindActive]}
        >
          <Text style={styles.kindEmoji}>🧳</Text>
          <Text style={styles.kindTitle}>Plan a trip</Text>
          <Text style={styles.kindCopy}>
            Available only to trusted members.
          </Text>
        </TouchableOpacity>
      </View>
      {kind === "trip" && (
        <>
          <View style={styles.tripHero}>
            <Text style={styles.tripHeroTitle}>Trusted trips</Text>
            <Text style={styles.tripHeroText}>
              Trips unlock after 3 successfully attended local plans, profile
              verification and no active safety restrictions.
            </Text>
          </View>
          <View style={styles.tripWarning}>
            <Text style={styles.tripWarningTitle}>Public trips first</Text>
            <Text style={styles.meta}>
              V0 allows only local day trips with a public start point. Private
              stays, international travel and rides with unverified members
              remain blocked.
            </Text>
          </View>
        </>
      )}
      <Text style={styles.sectionTitle}>
        {kind === "trip" ? "Trip essentials" : "Local plan essentials"}
      </Text>
      <Field
        label={
          kind === "trip" ? "Destination and purpose" : "Activity and purpose"
        }
        value={title}
        onChangeText={setTitle}
        placeholder={
          kind === "trip"
            ? "Nandi Hills sunrise day trip"
            : "Badminton after work"
        }
      />
      <Field
        label={kind === "trip" ? "Public meeting point" : "Approximate area"}
        value={area}
        onChangeText={setArea}
        placeholder="Indiranagar"
      />
      <Field
        label={
          kind === "trip" ? "Start and return time" : "Date and start time"
        }
        value={startsAt}
        onChangeText={setStartsAt}
        placeholder="Sunday · 7:00 AM"
      />
      <Field
        label="Group language"
        value={language}
        onChangeText={setLanguage}
        placeholder="English · Malayalam"
      />
      <Field
        label="Total group size"
        value={spots}
        onChangeText={setSpots}
        placeholder="4"
        keyboardType="number-pad"
      />
      {kind === "trip" && (
        <View style={styles.requiredList}>
          <Text style={styles.requiredTitle}>Required before publishing</Text>
          <Text style={styles.meta}>
            Transport plan · expected cost · return point · emergency sharing ·
            cancellation agreement
          </Text>
        </View>
      )}
      <TouchableOpacity
        disabled={saving}
        onPress={submit}
        style={[
          styles.primaryWide,
          kind === "trip" && styles.tripButton,
          saving && styles.joined,
        ]}
      >
        <Text style={styles.primaryText}>
          {saving
            ? "Saving…"
            : kind === "trip"
              ? "Save trusted trip"
              : "Save local plan"}
        </Text>
      </TouchableOpacity>
      <View style={{ height: 90 }} />
    </ScrollView>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: "default" | "number-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor="#9A9F9C"
        style={styles.input}
      />
    </View>
  );
}

function Groups({ profile }: { profile: LocalProfile }) {
  return cloudEnabled ? <CloudGroups profile={profile} /> : <LocalGroups />;
}

function CloudGroups({ profile }: { profile: LocalProfile }) {
  const [groups, setGroups] = useState<CloudGroup[]>([]);
  const [requests, setRequests] = useState<Record<string, CloudRequest[]>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState(profile.zone);
  const [category, setCategory] = useState("Sports");
  const [womenOnly, setWomenOnly] = useState(false);
  const [trustedOnly, setTrustedOnly] = useState(false);
  async function refresh() {
    await initializeCloudIdentity(profile);
    setUserId(await currentCloudUserId());
    setGroups(await listCloudGroups(profile.city));
  }
  useEffect(() => {
    refresh().catch((e) => Alert.alert("Cloud sync error", e.message));
    return watchCloudGroups(() => refresh().catch(() => {}));
  }, []);
  async function create() {
    if (!title.trim() || !area.trim())
      return Alert.alert(
        "Complete the group",
        "Add a name and approximate area.",
      );
    try {
      await createCloudGroup({
        title,
        category,
        city: profile.city,
        area,
        language: profile.languages,
        description: `A ${category.toLowerCase()} group in ${area}`,
        women_only: womenOnly,
        trusted_only: trustedOnly,
      });
      setCreating(false);
      setTitle("");
      await refresh();
    } catch (e: any) {
      Alert.alert("Could not create group", e.message);
    }
  }
  async function join(id: string) {
    try {
      await requestCloudMembership(id);
      Alert.alert(
        "Request sent",
        "The host can now approve you from their phone.",
      );
    } catch (e: any) {
      Alert.alert(
        "Could not request",
        e.code === "23505" ? "You already requested this group." : e.message,
      );
    }
  }
  async function loadRequests(id: string) {
    try {
      setRequests({ ...requests, [id]: await listCloudHostRequests(id) });
    } catch (e: any) {
      Alert.alert("Could not load requests", e.message);
    }
  }
  async function decide(
    groupId: string,
    memberId: string,
    status: "approved" | "rejected" | "removed" | "blocked",
  ) {
    try {
      await decideCloudMembership(groupId, memberId, status);
      await loadRequests(groupId);
    } catch (e: any) {
      Alert.alert("Could not update member", e.message);
    }
  }
  if (creating)
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>SYNCED GROUP</Text>
        <Text style={styles.h1}>Create for {profile.city}</Text>
        <Field
          label="Group name"
          value={title}
          onChangeText={setTitle}
          placeholder="Weekend badminton circle"
        />
        <Field
          label="Category"
          value={category}
          onChangeText={setCategory}
          placeholder="Sports, travel, food or shopping"
        />
        <Field
          label="Approximate area"
          value={area}
          onChangeText={setArea}
          placeholder={profile.zone}
        />
        <Toggle
          label="Women only"
          detail="Only server-verified women can rate safety"
          value={womenOnly}
          onPress={() => setWomenOnly(!womenOnly)}
        />
        <Toggle
          label="Trusted only"
          detail="For higher-trust outings and trips"
          value={trustedOnly}
          onPress={() => setTrustedOnly(!trustedOnly)}
        />
        <TouchableOpacity onPress={create} style={styles.primaryWide}>
          <Text style={styles.primaryText}>Publish group</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setCreating(false)}
          style={styles.editButton}
        >
          <Text style={styles.editText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.sectionRow}>
        <View>
          <Text style={styles.h1}>Groups in {profile.city}</Text>
          <Text style={styles.intro}>Synced safely across phones.</Text>
        </View>
        <TouchableOpacity
          onPress={() => setCreating(true)}
          style={styles.smallAdd}
        >
          <Text style={styles.primaryText}>＋ Group</Text>
        </TouchableOpacity>
      </View>
      {groups.length === 0 ? (
        <Empty
          emoji="☁️"
          title="No synced groups yet"
          body="Create the first activity group in your city."
          action="Use + Group above"
        />
      ) : (
        groups.map((g) => {
          const hosted = g.host_id === userId;
          const groupRequests = requests[g.id];
          return (
            <View key={g.id} style={styles.card}>
              <Text style={styles.cardTitle}>{g.title}</Text>
              <Text style={styles.audience}>
                {hosted
                  ? "You host this group"
                  : g.women_only
                    ? "Women only"
                    : g.trusted_only
                      ? "Trusted only"
                      : "Open group"}
              </Text>
              <Text style={styles.meta}>
                {g.category} · 📍 {g.area} · {g.language}
              </Text>
              {hosted ? (
                <>
                  <TouchableOpacity
                    onPress={() => loadRequests(g.id)}
                    style={styles.manageButton}
                  >
                    <Text style={styles.primaryText}>
                      {groupRequests ? "Refresh requests" : "Manage requests"}
                    </Text>
                  </TouchableOpacity>
                  {groupRequests?.map((r) => (
                    <View key={r.user_id} style={styles.memberRow}>
                      <Text style={styles.kindTitle}>{r.display_name}</Text>
                      <Text style={styles.meta}>{r.status}</Text>
                      {r.status === "pending" && (
                        <View style={styles.memberActions}>
                          <TouchableOpacity
                            onPress={() => decide(g.id, r.user_id, "approved")}
                            style={styles.approveButton}
                          >
                            <Text style={styles.primaryText}>Approve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => decide(g.id, r.user_id, "rejected")}
                            style={styles.miniButton}
                          >
                            <Text style={styles.editText}>Reject</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ))}
                </>
              ) : (
                <View style={styles.cardBottom}>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        await submitCloudSafetyRating(g.id, 5);
                        Alert.alert("Safety rating saved");
                      } catch (e: any) {
                        Alert.alert("Rating unavailable", e.message);
                      }
                    }}
                  >
                    <Text style={styles.rateText}>Rate safety ★</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => join(g.id)}
                    style={styles.join}
                  >
                    <Text style={styles.joinText}>Ask to join</Text>
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity
                onPress={async () => {
                  try {
                    await submitCloudReport(
                      g.id,
                      "Safety concern submitted from the Nook group screen.",
                    );
                    Alert.alert(
                      "Report received",
                      "A moderator—not an algorithm—will review it.",
                    );
                  } catch (e: any) {
                    Alert.alert("Could not report", e.message);
                  }
                }}
              >
                <Text style={[styles.meta, { marginTop: 14 }]}>
                  Report a safety concern
                </Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}
      <View style={{ height: 92 }} />
    </ScrollView>
  );
}

function LocalGroups() {
  const db = useSQLiteContext();
  const [groups, setGroups] = useState<StoredGroup[]>([]);
  const [memberships, setMemberships] = useState<GroupMembership[]>([]);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<StoredGroup | null>(null);
  const [ownedIds, setOwnedIds] = useState<number[]>([]);
  const [gender, setGenderState] = useState("prefer_not_to_say");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Sports");
  const [area, setArea] = useState("");
  const [language, setLanguage] = useState("English");
  const [description, setDescription] = useState("");
  const [womenOnly, setWomenOnly] = useState(false);
  const [trustedOnly, setTrustedOnly] = useState(false);
  async function refresh() {
    const next = await listGroups(db);
    setGroups(next);
    setMemberships(await listMemberships(db));
    setGenderState(await getGender(db));
    setOwnedIds(
      (
        await Promise.all(
          next.map(async (g) => ((await isOwnedGroup(db, g.id)) ? g.id : 0)),
        )
      ).filter(Boolean),
    );
  }
  useEffect(() => {
    refresh().catch(() =>
      Alert.alert("Storage error", "Could not load local groups."),
    );
  }, []);
  async function create() {
    if (!title.trim() || !area.trim())
      return Alert.alert(
        "Complete the group",
        "Add a group name and approximate area.",
      );
    await saveGroup(db, {
      title,
      category,
      area,
      language,
      description,
      women_only: 0,
      trusted_only: 0,
      womenOnly,
      trustedOnly,
    });
    setCreating(false);
    setTitle("");
    setDescription("");
    await refresh();
  }
  async function join(g: StoredGroup) {
    if (g.women_only && gender !== "woman")
      return Alert.alert(
        "Women-only group",
        "Face and gender verification will be required before approval.",
      );
    if (g.trusted_only && !canUseTrips)
      return Alert.alert(
        "Trusted members only",
        "Complete verification and attend three local plans first.",
      );
    await requestGroupJoin(db, g.id);
    await refresh();
  }
  async function rate(g: StoredGroup, n: number) {
    try {
      await rateGroupSafety(db, g.id, n);
      await refresh();
    } catch {
      Alert.alert(
        "Women-only safety rating",
        "Only women members can submit group safety ratings. This helps reduce rating manipulation.",
      );
    }
  }
  if (managing)
    return (
      <HostConsole
        group={managing}
        onClose={async () => {
          setManaging(null);
          await refresh();
        }}
      />
    );
  if (creating)
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.h1}>Create a group</Text>
        <Text style={styles.intro}>
          Build around a real activity. Contact details stay private.
        </Text>
        <Field
          label="Group name"
          value={title}
          onChangeText={setTitle}
          placeholder="Weekend badminton circle"
        />
        <Field
          label="Category"
          value={category}
          onChangeText={setCategory}
          placeholder="Sports, travel, food or shopping"
        />
        <Field
          label="Approximate area"
          value={area}
          onChangeText={setArea}
          placeholder="Indiranagar"
        />
        <Field
          label="Language"
          value={language}
          onChangeText={setLanguage}
          placeholder="English · Malayalam"
        />
        <Field
          label="What will members do?"
          value={description}
          onChangeText={setDescription}
          placeholder="Friendly Sunday games for beginners"
        />
        <Toggle
          label="Women only"
          detail="Approval requires verification"
          value={womenOnly}
          onPress={() => setWomenOnly(!womenOnly)}
        />
        <Toggle
          label="Trusted members only"
          detail="Useful for trips and higher-trust outings"
          value={trustedOnly}
          onPress={() => setTrustedOnly(!trustedOnly)}
        />
        <TouchableOpacity onPress={create} style={styles.primaryWide}>
          <Text style={styles.primaryText}>Create local group</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setCreating(false)}
          style={styles.editButton}
        >
          <Text style={styles.editText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.sectionRow}>
        <View>
          <Text style={styles.h1}>Activity groups</Text>
          <Text style={styles.intro}>
            Belong through shared plans—not swiping.
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setCreating(true)}
          style={styles.smallAdd}
        >
