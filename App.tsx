import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  BackHandler,
  Image,
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
import { enablePlanNotifications, notificationPermissionGranted, syncApprovedPlanReminders } from "./src/notifications";
import { cloudEnabled } from "./src/supabase";
import {
  createCloudGroup,
  createCloudPlan,
  createConnectionQrToken,
  currentCloudUserId,
  decideCloudMembership,
  initializeCloudIdentity,
  listCloudGroups,
  listCloudPlans,
  listMyCloudPlanRequests,
  listMyHostedPlanRequests,
  decideCloudPlanRequest,
  requestCloudPlan,
  getCloudPlanHost,
  listMyNotifications,
  markNotificationsRead,
  watchMyNotifications,
  listCloudHostRequests,
  requestCloudMembership,
  requestCloudConnection,
  hasCloudConnection,
  getCloudAccountSummary,
  submitCloudReport,
  submitCloudSafetyRating,
  watchCloudGroups,
  watchCloudPlans,
  type CloudGroup,
  type CloudRequest,
} from "./src/cloud";

type Tab = "Discover" | "Communities" | "Create" | "My Plans" | "Profile";
type Hangout = {
  id: number | string;
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
  creatorId?: string;
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
const bengaluruAreas = ["Indiranagar", "Koramangala", "HSR Layout", "Whitefield", "Jayanagar", "Malleshwaram", "Church Street", "Electronic City"];
const planTimes = ["07:00", "09:00", "11:00", "15:00", "17:30", "19:00"];

function nextPlanDays() {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset + 1);
    return date;
  });
}

function toPlanIso(day: Date | null, time: string) {
  if (!day || !time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(day);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function formatPlanTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
const hangouts: Hangout[] = [
  {
    id: 1,
    emoji: "🏸",
    category: "Sports",
    title: "Badminton after work",
    area: "Indiranagar",
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
  const [selectedPlan, setSelectedPlan] = useState<Hangout | null>(null);
  const [category, setCategory] = useState("All");
  const [joined, setJoined] = useState<(number | string)[]>([]);
  const [localPlans, setLocalPlans] = useState<Hangout[]>([]);
  const [profile, setProfile] = useState<LocalProfile | null | undefined>(
    undefined,
  );
  async function refreshPlans() {
    try {
      const rows = await listCloudPlans(profile?.city ?? "");
      setLocalPlans(rows.map((p) => ({ id:p.id, emoji:p.trusted_only?"🧳":"✨", category:p.category,
        title:p.title, area:p.area, time:formatPlanTime(p.starts_at), host:"Nook member", spots:p.spots,
        language:p.language, audience:p.trusted_only?"Trusted members only":"Open plan", safety:0,
        trustedOnly:p.trusted_only, creatorId:p.creator_id })));
    } catch {
      const rows = await listPlans(db);
      setLocalPlans(rows.map(toHangout));
    }
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
  useEffect(() => cloudEnabled ? watchCloudPlans(() => refreshPlans().catch(() => {})) : undefined,
    [profile?.city]);
  useEffect(() => {
    if (profile && cloudEnabled)
      initializeCloudIdentity(profile).catch(() =>
        Alert.alert(
          "Profile sync pending",
          "Your local profile is safe. Nook will retry cloud sync when you open Groups.",
        ),
      );
  }, [profile]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "Discover") return false;
      setTab("Discover");
      return true;
    });
    return () => subscription.remove();
  }, [tab]);
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
        {selectedPlan ? (
          <ActivityDetail plan={selectedPlan} onClose={() => setSelectedPlan(null)} onRequested={(id) => {
            setJoined((current) => current.includes(id) ? current : [...current, id]);
            setSelectedPlan(null);
            setTab("My Plans");
          }} />
        ) : <>
        {tab === "Discover" && (
          <Discover
            profile={profile}
            onSelect={setSelectedPlan}
            visible={visible}
            category={category}
            setCategory={setCategory}
            joined={joined}
            setJoined={setJoined}
          />
        )}
        {tab === "Communities" && <Groups profile={profile} />}
        {tab === "Create" && (
          <CreateHub
            onCreated={async () => {
              await refreshPlans();
              setTab("Discover");
            }}
          />
        )}
        {tab === "My Plans" && <Plans joined={joined} onBrowse={() => setTab("Discover")} />}
        {tab === "Profile" && profile && (
          <Profile profile={profile} onEdit={() => setProfile(null)} />
        )}
        <Nav active={tab} onChange={setTab} />
        </>}
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

function Discover({ profile, visible, category, setCategory, joined, setJoined, onSelect }: any) {
  const palette: Record<string, { bg: string; ink: string; soft: string }> = {
    Sports: { bg: "#DDF4EA", ink: "#145E4F", soft: "#EFFAF6" },
    "Women only": { bg: "#F7E5F1", ink: "#813B68", soft: "#FFF5FB" },
    "New in city": { bg: "#E7EBFF", ink: "#4450A0", soft: "#F4F5FF" },
    Trips: { bg: "#E8E7FA", ink: "#554A9B", soft: "#F6F5FF" },
    Food: { bg: "#FFF0D5", ink: "#8A5A10", soft: "#FFF9EE" },
    Shopping: { bg: "#FCE4DC", ink: "#984D38", soft: "#FFF5F1" },
  };
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{profile.city.toUpperCase()} ▾</Text>
          <Text style={styles.h1}>What feels good{`\n`}today?</Text>
        </View>
        <View style={styles.headerIdentity}>
          <Image source={require("./assets/icon-v4.png")} style={styles.brandIcon} />
          <View style={styles.avatar}>
          <Text style={styles.avatarText}>{profile.name.slice(0, 1).toUpperCase()}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity style={styles.storyHero} activeOpacity={0.9} onPress={() => visible[0] && onSelect(visible[0])}>
        <View style={styles.storyCopy}>
          <Text style={styles.storyKicker}>NEAR YOU · THIS WEEK</Text>
          <Text style={styles.storyTitle}>{visible[0]?.title ?? "Make a plan worth leaving home for"}</Text>
          <Text style={styles.storyMeta}>{visible[0] ? `${visible[0].area}  •  ${visible[0].spots} spots left` : "Create the first activity in your area"}</Text>
        </View>
        <View style={styles.storyIcon}><Text style={styles.storyEmoji}>{visible[0]?.emoji ?? "✨"}</Text></View>
      </TouchableOpacity>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={[styles.legendDot,{backgroundColor:"#2E8B72"}]} /><Text style={styles.legendText}>Open</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot,{backgroundColor:"#E9A23B"}]} /><Text style={styles.legendText}>Few spots</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot,{backgroundColor:"#6057B2"}]} /><Text style={styles.legendText}>Trusted only</Text></View>
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
        <Text style={styles.muted}>{visible.length} activities</Text>
      </View>
      <View style={styles.activityGrid}>
      {visible.map((h: Hangout) => {
        const isJoined = joined.includes(h.id);
        const tone = palette[h.category] ?? { bg: "#E8F2EF", ink: "#247064", soft: "#F5FAF8" };
        return (
          <TouchableOpacity key={h.id} activeOpacity={0.88} onPress={() => onSelect(h)} style={[styles.activityTile,{backgroundColor:tone.soft}]}>
            <View style={styles.cardTop}>
              <View style={[styles.icon,{backgroundColor:tone.bg}]}>
                <Text style={styles.iconText}>{h.emoji}</Text>
              </View>
              <View style={[styles.statusDot,{backgroundColor:h.trustedOnly?"#6057B2":h.spots<=2?"#E9A23B":"#2E8B72"}]} />
            </View>
            <Text style={[styles.tileCategory,{color:tone.ink}]}>{h.category.toUpperCase()}</Text>
            <Text style={styles.tileTitle} numberOfLines={2}>{h.title}</Text>
            <Text style={styles.tileTime} numberOfLines={1}>{h.time}</Text>
            <Text style={styles.tileArea} numberOfLines={1}>⌖ {h.area}</Text>
            <View style={styles.tileFooter}>
              <Text style={[styles.tileSpots,{color:tone.ink}]}>{isJoined ? "Requested" : `${h.spots} spots`}</Text>
              <Text style={[styles.tileArrow,{color:tone.ink}]}>→</Text>
            </View>
          </TouchableOpacity>
        );
      })}
      </View>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function CreateHub({ onCreated }: { onCreated: () => Promise<void> }) {
  const db = useSQLiteContext();
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [kind, setKind] = useState<"local" | "trip">("local");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [day, setDay] = useState<Date | null>(null);
  const [time, setTime] = useState("");
  const [language, setLanguage] = useState("English");
  const [spots, setSpots] = useState("4");
  const [saving, setSaving] = useState(false);
  useEffect(() => { getProfile(db).then(setProfile); }, []);
  async function submit() {
    const startsAt = toPlanIso(day, time);
    if (!title.trim() || !area.trim() || !startsAt)
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
      if (!profile) throw new Error("Profile unavailable");
      await createCloudPlan({
        title,
        category: kind === "trip" ? "Trips" : "New in city",
        city: profile.city,
        area,
        starts_at: startsAt,
        language,
        spots: count,
        trusted_only: kind === "trip",
      });
      Alert.alert("Plan published", "Friends in your city can now see it from anywhere.");
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
      <ChoiceField label={kind === "trip" ? "Public meeting area" : "Approximate area"} options={bengaluruAreas} value={area} onChange={setArea} />
      <ChoiceField label="Choose a day" options={nextPlanDays().map((d) => d.toISOString())} value={day?.toISOString() ?? ""} onChange={(v) => setDay(new Date(v))} format={(v) => new Date(v).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} />
      <ChoiceField label={kind === "trip" ? "Departure time" : "Start time"} options={planTimes} value={time} onChange={setTime} format={(v) => { const [h,m]=v.split(":").map(Number); return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}); }} />
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

function ChoiceField({ label, options, value, onChange, format = (v) => v }: { label: string; options: string[]; value: string; onChange: (v: string) => void; format?: (v: string) => string }) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>
      {options.map((option) => <TouchableOpacity key={option} onPress={() => onChange(option)} style={[styles.choice, value === option && styles.choiceActive]}>
        <Text style={[styles.choiceText, value === option && styles.choiceTextActive]}>{format(option)}</Text>
      </TouchableOpacity>)}
    </ScrollView>
  </View>;
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
          <Text style={styles.h1}>Communities</Text>
          <Text style={styles.intro}>Recurring circles in {profile.city}.</Text>
        </View>
        <TouchableOpacity
          onPress={() => setCreating(true)}
          style={styles.smallAdd}
        >
          <Text style={styles.primaryText}>Create</Text>
        </TouchableOpacity>
      </View>
      {groups.length === 0 ? (
        <Empty
          emoji="☁️"
          title="No communities yet"
          body="Create a recurring circle for people who enjoy the same activity."
          action="Create a community"
          onPress={() => setCreating(true)}
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
          <Text style={styles.primaryText}>＋ Group</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.genderBox}>
        <Text style={styles.safetyTitle}>Safety-rating eligibility</Text>
        <Text style={styles.meta}>
          Choose locally. Verification will be added before public release.
        </Text>
        <View style={styles.wrap}>
          {[
            ["woman", "Woman"],
            ["man", "Man"],
            ["prefer_not_to_say", "Prefer not to say"],
          ].map(([v, l]) => (
            <TouchableOpacity
              key={v}
              onPress={async () => {
                await setGender(db, v);
                setGenderState(v);
              }}
              style={[styles.chip, gender === v && styles.chipActive]}
            >
              <Text
                style={[styles.chipText, gender === v && styles.chipTextActive]}
              >
                {l}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {groups.length === 0 ? (
        <Empty
          emoji="🫶"
          title="Create the first local group"
          body="Sports, trips, restaurant hopping, shopping or a women-only circle."
          action="Use + Group above"
        />
      ) : (
        groups.map((g) => {
          const owned = ownedIds.includes(g.id);
          const membership = memberships.find((m) => m.group_id === g.id);
          const score = g.safety_count ? g.safety_total / g.safety_count : 0;
          return (
            <View key={g.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.icon}>
                  <Text style={styles.iconText}>
                    {g.category.toLowerCase().includes("sport")
                      ? "🏸"
                      : g.category.toLowerCase().includes("travel")
                        ? "🧳"
                        : "✨"}
                  </Text>
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>
                    {score ? `★ ${score.toFixed(1)} safety` : "New group"}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardTitle}>{g.title}</Text>
              <Text style={styles.audience}>
                {owned
                  ? "You host this group"
                  : g.women_only
                    ? "Verified women only"
                    : g.trusted_only
                      ? "Trusted members only"
                      : "Open group"}
              </Text>
              <Text style={styles.meta}>{g.description || g.category}</Text>
              <Text style={styles.meta}>
                📍 {g.area} · {g.language}
              </Text>
              <View style={styles.cardBottom}>
                <TouchableOpacity onPress={() => rate(g, 5)}>
                  <Text style={styles.rateText}>Rate safety ★</Text>
                </TouchableOpacity>
                {owned ? (
                  <TouchableOpacity
                    onPress={() => setManaging(g)}
                    style={styles.manageButton}
                  >
                    <Text style={styles.primaryText}>Manage</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    disabled={!!membership}
                    onPress={() => join(g)}
                    style={[styles.join, membership && styles.joined]}
                  >
                    <Text style={styles.joinText}>
                      {membership ? "Approval pending" : "Ask to join"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })
      )}
      <View style={{ height: 92 }} />
    </ScrollView>
  );
}

function HostConsole({
  group,
  onClose,
}: {
  group: StoredGroup;
  onClose: () => Promise<void>;
}) {
  const db = useSQLiteContext();
  const [requests, setRequests] = useState<HostRequest[]>([]);
  const [moderation, setModeration] = useState<ModerationState | null>(null);
  async function refresh() {
    setRequests(await listHostRequests(db, group.id));
    setModeration((await getModerationState(db, group.id)) ?? null);
  }
  useEffect(() => {
    refresh();
  }, []);
  async function act(id: number, status: HostRequest["status"]) {
    await updateHostRequest(db, id, status);
    await refresh();
  }
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>HOST CONSOLE</Text>
      <Text style={styles.h1}>{group.title}</Text>
      <View
        style={[
          styles.reviewBox,
          moderation?.status === "restricted" && styles.restrictedBox,
        ]}
      >
        <Text style={styles.kindTitle}>
          Status: {moderation?.status.replace("_", " ") ?? "clear"}
        </Text>
        <Text style={styles.meta}>
          {moderation?.report_count ?? 0} report(s). Low ratings and reports
          open a review; they never permanently ban automatically.
        </Text>
        {moderation?.restriction_until && (
          <Text style={styles.meta}>
            Restricted until{" "}
            {new Date(moderation.restriction_until).toLocaleDateString()}
          </Text>
        )}
        <View style={styles.wrap}>
          <TouchableOpacity
            onPress={async () => {
              await reportGroup(db, group.id);
              await refresh();
            }}
            style={styles.miniButton}
          >
            <Text style={styles.editText}>Open review</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              await restrictGroup(db, group.id, 7);
              await refresh();
            }}
            style={styles.dangerButton}
          >
            <Text style={styles.primaryText}>Restrict 7 days</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              await clearGroupReview(db, group.id);
              await refresh();
            }}
            style={styles.miniButton}
          >
            <Text style={styles.editText}>Clear review</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Join requests</Text>
        <TouchableOpacity
          onPress={async () => {
            await addTestHostRequest(db, group.id);
            await refresh();
          }}
        >
          <Text style={styles.rateText}>＋ Test request</Text>
        </TouchableOpacity>
      </View>
      {requests.length === 0 ? (
        <Text style={styles.meta}>
          No requests yet. “Test request” previews the approval flow on this
          local build.
        </Text>
      ) : (
        requests.map((r) => (
          <View key={r.id} style={styles.memberRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kindTitle}>{r.display_name}</Text>
              <Text style={styles.meta}>
                {r.account_code} · {r.trusted ? "Trusted" : "Not trusted"} ·{" "}
                {r.status}
              </Text>
            </View>
            {r.status === "pending" ? (
              <View style={styles.memberActions}>
                <TouchableOpacity
                  onPress={() => act(r.id, "approved")}
                  style={styles.approveButton}
                >
                  <Text style={styles.primaryText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => act(r.id, "rejected")}
                  style={styles.miniButton}
                >
                  <Text style={styles.editText}>Reject</Text>
                </TouchableOpacity>
              </View>
            ) : r.status === "approved" ? (
              <View style={styles.memberActions}>
                <TouchableOpacity
                  onPress={() => act(r.id, "removed")}
                  style={styles.miniButton}
                >
                  <Text style={styles.editText}>Remove</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => act(r.id, "blocked")}
                  style={styles.dangerButton}
                >
                  <Text style={styles.primaryText}>Block</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ))
      )}
      <TouchableOpacity onPress={onClose} style={styles.primaryWide}>
        <Text style={styles.primaryText}>Done</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Toggle({
  label,
  detail,
  value,
  onPress,
}: {
  label: string;
  detail: string;
  value: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.kindTitle}>{label}</Text>
        <Text style={styles.meta}>{detail}</Text>
      </View>
      <View style={[styles.toggle, value && styles.toggleOn]}>
        <View style={[styles.toggleDot, value && styles.toggleDotOn]} />
      </View>
    </TouchableOpacity>
  );
}

function ActivityDetail({ plan, onClose, onRequested }: { plan: Hangout; onClose: () => void; onRequested: (id: number | string) => void }) {
  const [host, setHost] = useState(plan.host);
  const [busy, setBusy] = useState(false);
  const [trust, setTrust] = useState<{faceVerified:boolean;attendedPlans:number}|null>(null);
  useEffect(() => {
    getCloudAccountSummary().then((a) => setTrust({faceVerified:a.faceVerified,attendedPlans:a.attendedPlans})).catch(() => {});
    if (plan.creatorId) getCloudPlanHost(plan.creatorId).then((p) => p?.display_name && setHost(p.display_name)).catch(() => {});
  }, [plan.id]);
  const eligible = !plan.trustedOnly || (!!trust?.faceVerified && trust.attendedPlans >= 3);
  async function request() {
    if (!eligible) return Alert.alert("Trusted activity", "Complete face approval and attend three local activities first.");
    setBusy(true);
    try {
      if (typeof plan.id === "string") await requestCloudPlan(plan.id);
      onRequested(plan.id);
    } catch (e:any) {
      if (e.code === "23505") onRequested(plan.id);
      else Alert.alert("Could not request", e.message ?? "Please try again.");
    } finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={styles.detailPage} showsVerticalScrollIndicator={false}>
    <TouchableOpacity onPress={onClose} style={styles.detailBack}><Text style={styles.detailBackText}>‹  Discover</Text></TouchableOpacity>
    <View style={styles.detailHero}><Text style={styles.detailEmoji}>{plan.emoji}</Text><Text style={styles.detailCategory}>{plan.category.toUpperCase()}</Text><Text style={styles.detailTitle}>{plan.title}</Text><Text style={styles.detailTime}>{plan.time}</Text></View>
    <View style={styles.detailCard}><Text style={styles.detailLabel}>WHERE</Text><Text style={styles.detailValue}>📍 {plan.area}</Text><Text style={styles.detailNote}>Only the approximate public area is shown before approval.</Text></View>
    <View style={styles.detailCard}><Text style={styles.detailLabel}>HOST</Text><Text style={styles.detailValue}>{host}</Text><Text style={styles.detailNote}>{plan.language} · {plan.spots} spots remaining</Text></View>
    <View style={styles.detailCard}><Text style={styles.detailLabel}>SAFETY BEFORE CHAT</Text><View style={styles.safetyLine}><Text style={styles.safetyStrong}>{plan.safety ? `★ ${plan.safety}` : "New activity"}</Text><Text style={styles.detailNote}>{plan.audience}</Text></View><Text style={styles.detailNote}>Your phone number and exact location stay private. Meet first in a public place.</Text></View>
    {plan.trustedOnly && <View style={[styles.detailCard, styles.lockedCard]}><Text style={styles.detailValue}>🔒 Trusted members only</Text><Text style={styles.detailNote}>{eligible ? "You meet the current trust requirements." : `Face approval and 3 attended plans required. Current: ${trust?.attendedPlans ?? 0}/3.`}</Text></View>}
    <TouchableOpacity disabled={busy} onPress={request} style={[styles.primaryWide, !eligible && styles.disabledAction]}><Text style={styles.primaryText}>{busy ? "Sending request…" : eligible ? "Request to join" : "Complete trust checks first"}</Text></TouchableOpacity>
    <Text style={styles.detailFootnote}>The host reviews your request. Contact details are never shared automatically.</Text>
  </ScrollView>;
}

function Plans({ joined, onBrowse }: { joined: (number | string)[]; onBrowse: () => void }) {
  const [cloudRequests, setCloudRequests] = useState<any[]>([]);
  const [hostRequests, setHostRequests] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  async function refreshRequests() { const [mine, hosted, alerts] = await Promise.all([listMyCloudPlanRequests(),listMyHostedPlanRequests(),listMyNotifications()]); setCloudRequests(mine); setHostRequests(hosted); setNotifications(alerts); }
  useEffect(() => { notificationPermissionGranted().then(setRemindersEnabled).catch(() => {}); refreshRequests().catch(() => {}); return watchMyNotifications(() => refreshRequests().catch(() => {})); }, [joined]);
  const plans = hangouts.filter((h) => joined.includes(h.id));
  const cloudPlans = cloudRequests.filter((r) => r.plan).map((r) => ({...r.plan, requestStatus:r.status}));
  useEffect(() => { if (remindersEnabled) syncApprovedPlanReminders(cloudPlans).catch(() => {}); }, [remindersEnabled, cloudRequests]);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.h1}>My plans</Text>
      <Text style={styles.intro}>
        Requests and confirmed meetups appear here.
      </Text>
      <View style={styles.reminderCard}>
        <View style={styles.reminderIcon}><Text style={styles.reminderIconText}>🔔</Text></View>
        <View style={{flex:1}}><Text style={styles.alertTitle}>Plan reminders</Text><Text style={styles.meta}>{remindersEnabled ? "Android will remind you 2 hours before approved activities." : "Enable private reminders on this phone."}</Text></View>
        {!remindersEnabled && <TouchableOpacity style={styles.reminderButton} onPress={async()=>{const enabled=await enablePlanNotifications();setRemindersEnabled(enabled);if(!enabled) Alert.alert("Notifications are off","You can enable Nook notifications later from Android settings.");}}><Text style={styles.reminderButtonText}>Enable</Text></TouchableOpacity>}
      </View>
      {notifications.length > 0 && <View style={styles.alertPanel}>
        <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Updates</Text>{notifications.some((n) => !n.read_at) && <TouchableOpacity onPress={async()=>{await markNotificationsRead(notifications.filter((n)=>!n.read_at).map((n)=>n.id));await refreshRequests();}}><Text style={styles.alertAction}>Mark read</Text></TouchableOpacity>}</View>
        {notifications.slice(0,4).map((n) => <View key={n.id} style={[styles.alertRow, !n.read_at && styles.alertUnread]}><Text style={styles.alertIcon}>{n.kind === "plan_request" ? "👋" : n.kind === "plan_approved" ? "✓" : "•"}</Text><View style={{flex:1}}><Text style={styles.alertTitle}>{n.title}</Text><Text style={styles.meta}>{n.body}</Text></View></View>)}
      </View>}
      {hostRequests.length > 0 && <><Text style={styles.sectionTitle}>Requests to your activities</Text>{hostRequests.map((r) => <View key={`${r.plan_id}-${r.user_id}`} style={styles.memberRow}><Text style={styles.kindTitle}>{r.displayName}</Text><Text style={styles.meta}>{r.plan?.title} · {r.status}</Text>{r.status === "pending" && <View style={styles.memberActions}><TouchableOpacity style={styles.approveButton} onPress={async()=>{await decideCloudPlanRequest(r.plan_id,r.user_id,"approved");await refreshRequests();}}><Text style={styles.primaryText}>Approve</Text></TouchableOpacity><TouchableOpacity style={styles.miniButton} onPress={async()=>{await decideCloudPlanRequest(r.plan_id,r.user_id,"rejected");await refreshRequests();}}><Text style={styles.editText}>Reject</Text></TouchableOpacity></View>}</View>)}</>}
      {(plans.length > 0 || cloudPlans.length > 0) && <Text style={styles.sectionTitle}>Your requests</Text>}
      {plans.length || cloudPlans.length ? (<>
        {cloudPlans.map((h) => <View key={h.id} style={styles.card}><Text style={styles.cardTitle}>{h.trusted_only ? "🧳" : "✨"} {h.title}</Text><Text style={styles.meta}>{formatPlanTime(h.starts_at)} · {h.area}</Text><View style={styles.pending}><Text style={styles.pendingText}>{h.requestStatus === "pending" ? "Waiting for host approval" : h.requestStatus}</Text></View></View>)}
        {plans.filter((h) => typeof h.id !== "string").map((h) => (
          <View key={h.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {h.emoji} {h.title}
            </Text>
            <Text style={styles.meta}>
              {h.time} · {h.area}
            </Text>
            <View style={styles.pending}>
              <Text style={styles.pendingText}>Waiting for host approval</Text>
            </View>
          </View>
        ))}</>
      ) : (
        <Empty
          emoji="☀"
          title="Nothing planned yet"
          body="Discover a hangout and ask to join. Your exact location is never shared publicly."
          action="Browse activities"
          onPress={onBrowse}
        />
      )}
    </ScrollView>
  );
}

function Onboarding({ onDone }: { onDone: () => Promise<void> }) {
  const db = useSQLiteContext();
  const [name, setName] = useState("");
  const [city, setCity] = useState("Bengaluru");
  const [zone, setZone] = useState("");
  const [languages, setLanguages] = useState("English");
  const [interests, setInterests] = useState("");
  const [bio, setBio] = useState("");
  async function submit() {
    if (!name.trim() || !zone.trim() || !interests.trim())
      return Alert.alert("Almost there", "Add your name, area and interests.");
    await saveProfile(db, { name, city, zone, languages, interests, bio });
    await onDone();
  }
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>LOCAL PROFILE</Text>
        <Text style={styles.h1}>What brings you outside?</Text>
        <Text style={styles.intro}>
          This stays on your phone for now. Share only what helps others
          understand the activity.
        </Text>
        <Field
          label="First name"
          value={name}
          onChangeText={setName}
          placeholder="Yadhu"
        />
        <Field
          label="City"
          value={city}
          onChangeText={setCity}
          placeholder="Bengaluru"
        />
        <Field
          label="Approximate area"
          value={zone}
          onChangeText={setZone}
          placeholder="Indiranagar"
        />
        <Field
          label="Languages"
          value={languages}
          onChangeText={setLanguages}
          placeholder="English · Malayalam"
        />
        <Field
          label="Interests"
          value={interests}
          onChangeText={setInterests}
          placeholder="Badminton, food, drawing"
        />
        <Field
          label="Short bio (optional)"
          value={bio}
          onChangeText={setBio}
          placeholder="New to the city and looking for weekend plans"
        />
        <TouchableOpacity onPress={submit} style={styles.primaryWide}>
          <Text style={styles.primaryText}>Create local profile</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Profile({
  profile,
  onEdit,
}: {
  profile: LocalProfile;
  onEdit: () => void;
}) {
  const initial = profile.name.slice(0, 1).toUpperCase();
  const [mode, setMode] = useState<"profile" | "show" | "scan">("profile");
  const [nonce, setNonce] = useState(Crypto.randomUUID());
  const [cloudQr, setCloudQr] = useState<{token:string;ownerId:string;expiresAt:string}|null>(null);
  const [account, setAccount] = useState<{username:string;email:string;emailVerified:boolean;gender:string;age:number|null;faceVerified:boolean;attendedPlans:number}|null>(null);
  useEffect(() => { getCloudAccountSummary().then(setAccount).catch(() => setAccount(null)); }, []);
  useEffect(() => { if (mode === "show") createConnectionQrToken().then(setCloudQr).catch(() => {
    Alert.alert("Could not create QR", "Connect to the internet and try again."); setMode("profile");
  }); }, [mode, nonce]);
  const payload = JSON.stringify({
    v: 2,
    type: "nook-connect",
    account: profile.account_code,
    name: profile.name,
    exp: cloudQr ? new Date(cloudQr.expiresAt).getTime() : 0,
    token: cloudQr?.token,
    userId: cloudQr?.ownerId,
  });
  if (mode === "show")
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.qrScreen}>
          <Text style={styles.h1}>Connect in person</Text>
          <Text style={styles.intro}>
            Ask the other person to scan this within 5 minutes.
          </Text>
          {cloudQr ? <QRCodeMatrix value={payload} /> : <Text style={styles.meta}>Creating secure QR…</Text>}
          <Text style={styles.accountCode}>{profile.account_code}</Text>
          <Text style={styles.qrCopy}>
            No phone number or contact list is shared.
          </Text>
          <TouchableOpacity
            onPress={() => {
              setNonce(Crypto.randomUUID());
              setMode("profile");
            }}
            style={styles.primaryWide}
          >
            <Text style={styles.primaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  if (mode === "scan")
    return (
      <QRScanner
        ownCode={profile.account_code}
        onClose={() => setMode("profile")}
      />
    );
  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingTop: 8, paddingBottom: 118 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.profileCard}>
        <View style={styles.profileGlow}>
          <View style={styles.bigAvatar}>
            <Text style={styles.bigAvatarText}>{initial}</Text>
          </View>
          <View style={styles.verified}>
            <Text style={styles.verifiedText}>{account?.emailVerified ? "✓ Email verified" : "Local profile"}</Text>
          </View>
        </View>
        <Text style={styles.profileName}>{profile.name}</Text>
        <Text style={styles.profileBio}>
          {profile.bio || "Ready for a real plan, not endless chatting"}
        </Text>
        <Text style={styles.profileLocation}>
          📍 {profile.zone}, {profile.city} · {profile.languages}
        </Text>
        {account?.username ? <Text style={styles.profileUsername}>@{account.username}</Text> : null}
        <View style={styles.qr}>
          <Text style={styles.qrMark}>▦</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.qrTitle}>Private connection</Text>
            <Text style={styles.accountCode}>{profile.account_code}</Text>
            <Text style={styles.qrCopy}>
              Use a rotating QR after meeting. Your phone number stays private.
            </Text>
          </View>
        </View>
        <View style={styles.qrActions}>
          <TouchableOpacity
            onPress={() => setMode("show")}
            style={styles.qrAction}
          >
            <Text style={styles.qrActionText}>Show my QR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode("scan")}
            style={styles.qrActionAlt}
          >
            <Text style={styles.qrActionAltText}>Scan QR</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.profileStats}>
        <View style={styles.profileStat}><Text style={styles.profileStatValue}>{account?.attendedPlans ?? 0}</Text><Text style={styles.profileStatLabel}>Plans joined</Text></View>
        <View style={styles.profileStat}><Text style={styles.profileStatValue}>{profile.interests.split(",").filter(Boolean).length}</Text><Text style={styles.profileStatLabel}>Interests</Text></View>
        <View style={styles.profileStat}><Text style={styles.profileStatValue}>{account?.age ?? "18+"}</Text><Text style={styles.profileStatLabel}>Age</Text></View>
      </View>
      <Text style={styles.sectionTitle}>My interests</Text>
      <View style={styles.wrap}>
        {profile.interests.split(",").map((x) => (
          <View key={x} style={styles.colorChip}>
            <Text style={styles.colorChipText}>{x.trim()}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sectionTitle}>Trust progress</Text>
      <View style={styles.trustPanel}>
        <TrustRow icon="✉" title="Email" value={account?.emailVerified ? "Verified" : "Pending"} done={!!account?.emailVerified} />
        <TrustRow icon="☺" title="Face approval" value={account?.faceVerified ? "Approved" : "Not started"} done={!!account?.faceVerified} />
        <TrustRow icon="☎" title="Phone number" value="Coming next" done={false} />
        <TrustRow icon="✓" title="Trusted trip access" value={`${account?.attendedPlans ?? 0}/3 plans`} done={(account?.attendedPlans ?? 0) >= 3} last />
      </View>
      <Text style={styles.sectionTitle}>Account & privacy</Text>
      <View style={styles.accountPanel}>
        <Text style={styles.accountLabel}>SIGNED IN AS</Text>
        <Text style={styles.accountValue}>{account?.email || "Loading account…"}</Text>
        <Text style={styles.accountHint}>Gender: {account?.gender?.replaceAll("_", " ") || "not shared"} · Contact details stay hidden until you choose to share.</Text>
      </View>
      <TouchableOpacity onPress={onEdit} style={styles.editButton}><Text style={styles.editText}>Edit profile</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => Alert.alert("Sign out?", "Your local profile stays on this phone.", [{text:"Cancel",style:"cancel"},{text:"Sign out",style:"destructive",onPress:()=>getCloudAccountSummary(true)}])} style={styles.signOutButton}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function TrustRow({icon,title,value,done,last=false}:{icon:string;title:string;value:string;done:boolean;last?:boolean}) {
  return <View style={[styles.trustRow, last && {borderBottomWidth:0}]}><Text style={styles.trustRowIcon}>{icon}</Text><View style={{flex:1}}><Text style={styles.trustRowTitle}>{title}</Text><Text style={styles.trustRowValue}>{value}</Text></View><Text style={[styles.trustCheck, done && styles.trustCheckDone]}>{done ? "✓" : "○"}</Text></View>;
}

function QRScanner({
  ownCode,
  onClose,
}: {
  ownCode: string;
  onClose: () => void;
}) {
  const db = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  async function scanned({ data }: { data: string }) {
    if (locked) return;
    setLocked(true);
    try {
      const p = JSON.parse(data);
      if (
        p.type !== "nook-connect" ||
        p.v !== 2 ||
        !p.account ||
        !p.name ||
        !p.exp || !p.token || !p.userId
      )
        throw new Error("format");
      if (p.account === ownCode)
        return Alert.alert(
          "That is your QR",
          "Ask the other person to show theirs.",
        );
      if (Date.now() > p.exp)
        return Alert.alert("QR expired", "Ask them to generate a new QR.");
      if (await hasCloudConnection(p.userId))
        return Alert.alert(
          "Already connected",
          "This account is already on your phone.",
        );
      Alert.alert(
        `Connect with ${p.name}?`,
        "This creates a pending connection. No contact details will be shared.",
        [
          { text: "Cancel", style: "cancel", onPress: () => setLocked(false) },
          {
            text: "Add pending",
            onPress: async () => {
              await requestCloudConnection(p.token, p.userId);
              await addPendingConnection(db, p.account, p.name).catch(() => {});
              Alert.alert("Connection requested", "They can see it from their own phone.");
              onClose();
            },
          },
        ],
      );
    } catch {
      Alert.alert(
        "Not a Nook QR",
        "Ask the person to open their connection QR.",
        [{ text: "Try again", onPress: () => setLocked(false) }],
      );
    }
  }
  if (!permission) return <SafeAreaView style={styles.safe} />;
  if (!permission.granted)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.qrScreen}>
          <Text style={styles.h1}>Scan connection QR</Text>
          <Text style={styles.intro}>
            Camera access is used only while this scanner is open.
          </Text>
          <TouchableOpacity
            onPress={requestPermission}
            style={styles.primaryWide}
          >
            <Text style={styles.primaryText}>Allow camera</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.editButton}>
            <Text style={styles.editText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.scanner}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanned}
      />
      <View style={styles.scanOverlay}>
        <Text style={styles.scanTitle}>Scan Nook QR</Text>
        <View style={styles.scanFrame} />
        <TouchableOpacity onPress={onClose} style={styles.scanClose}>
          <Text style={styles.primaryText}>Close scanner</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function Empty({
  emoji,
  title,
  body,
  action,
  onPress,
}: {
  emoji: string;
  title: string;
  body: string;
  action: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={[styles.meta, { textAlign: "center" }]}>{body}</Text>
      <TouchableOpacity style={styles.primary} onPress={onPress}>
        <Text style={styles.primaryText}>{action}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Nav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  const items: { name: Tab; icon: string }[] = [
    { name: "Discover", icon: "⌂" },
    { name: "Communities", icon: "◎" },
    { name: "Create", icon: "＋" },
    { name: "My Plans", icon: "◫" },
    { name: "Profile", icon: "◉" },
  ];
  return (
    <View style={styles.nav}>
      {items.map((i) => (
        <TouchableOpacity
          key={i.name}
          style={[styles.navItem, i.name === "Create" && styles.navCreate, active === i.name && i.name !== "Create" && styles.navItemActive]}
          onPress={() => onChange(i.name)}
        >
          <Text style={[styles.navIcon, active === i.name && styles.navActive, i.name === "Create" && styles.navCreateIcon]}>
            {i.icon}
          </Text>
          <Text style={[styles.navText, active === i.name && styles.navActive, i.name === "Create" && styles.navCreateText]}>
            {i.name === "Communities" ? "Community" : i.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F5F0" },
  shell: { flex: 1 },
  page: { padding: 16, paddingTop: 18 },
  detailPage: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  detailBack: { alignSelf: "flex-start", paddingVertical: 10, paddingRight: 20 },
  detailBackText: { color: "#247064", fontWeight: "900", fontSize: 15 },
  detailHero: { backgroundColor: "#503A82", borderRadius: 28, padding: 24, marginTop: 8, marginBottom: 14 },
  detailEmoji: { fontSize: 44, marginBottom: 20 },
  detailCategory: { color: "#F8C96F", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  detailTitle: { color: "#FFF", fontSize: 30, lineHeight: 35, fontWeight: "900", marginTop: 8 },
  detailTime: { color: "#E8DFFF", fontSize: 16, fontWeight: "700", marginTop: 12 },
  detailCard: { backgroundColor: "#FFF", borderRadius: 20, padding: 17, marginBottom: 11, borderWidth: 1, borderColor: "#ECEAE3" },
  detailLabel: { color: "#7A827F", fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginBottom: 7 },
  detailValue: { color: "#17211F", fontSize: 17, fontWeight: "900" },
  detailNote: { color: "#68716D", fontSize: 12, lineHeight: 18, marginTop: 5 },
  safetyLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  safetyStrong: { color: "#247064", fontSize: 17, fontWeight: "900" },
  lockedCard: { backgroundColor: "#FFF1D8", borderColor: "#F1D49B" },
  disabledAction: { backgroundColor: "#8A918E" },
  detailFootnote: { color: "#7A827F", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 10 },
  screenHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8 },
  backButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E8E4D9" },
  backIcon: { fontSize: 34, lineHeight: 35, color: "#17211F", marginTop: -3 },
  screenEyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.7, color: "#247064" },
  screenTitle: { fontSize: 23, fontWeight: "900", color: "#17211F", marginTop: 1 },
  miniBrand: { width: 38, height: 38, borderRadius: 14, backgroundColor: "#F0AF49", alignItems: "center", justifyContent: "center" },
  miniBrandText: { color: "#174E45", fontWeight: "900", fontSize: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerIdentity: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandIcon: { width: 42, height: 42, borderRadius: 14 },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "#247064",
    marginBottom: 8,
  },
  h1: {
    fontSize: 32,
    lineHeight: 35,
    fontWeight: "800",
    color: "#17211F",
    letterSpacing: -1,
  },
  intro: { fontSize: 16, color: "#68716D", marginTop: 8, marginBottom: 22 },
  storyHero: { minHeight: 156, borderRadius: 26, backgroundColor: "#073A51", marginTop: 18, marginBottom: 12, padding: 20, flexDirection: "row", overflow: "hidden", alignItems: "center" },
  storyCopy: { flex: 1, zIndex: 2 },
  storyKicker: { color: "#FFB37D", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  storyTitle: { color: "#FFF9ED", fontSize: 23, lineHeight: 27, fontWeight: "900", marginTop: 8 },
  storyMeta: { color: "#BFD9DF", fontSize: 12, fontWeight: "700", marginTop: 11 },
  storyIcon: { width: 76, height: 76, borderRadius: 24, backgroundColor: "#124F64", alignItems: "center", justifyContent: "center", transform: [{rotate:"7deg"}] },
  storyEmoji: { fontSize: 38, transform: [{rotate:"-7deg"}] },
  legendRow: { flexDirection: "row", gap: 14, alignItems: "center", marginBottom: 8, paddingHorizontal: 3 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: "#67716D", fontSize: 10, fontWeight: "700" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F0AF49",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontWeight: "800", fontSize: 17, color: "#17211F" },
  chips: { gap: 8, paddingVertical: 13 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "#ECEAE3",
  },
  chipActive: { backgroundColor: "#247064" },
  chipText: { fontWeight: "700", color: "#4F5955" },
  chipTextActive: { color: "white" },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#17211F",
    marginVertical: 14,
  },
  muted: { fontSize: 12, color: "#8A918E" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#ECEAE3",
  },
  activityGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 10 },
  activityTile: { width: "48.4%", minHeight: 220, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "#E9E8E2" },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  tileCategory: { fontSize: 9, fontWeight: "900", letterSpacing: 1.1, marginTop: 2 },
  tileTitle: { fontSize: 17, lineHeight: 21, minHeight: 44, fontWeight: "900", color: "#15221F", marginTop: 7 },
  tileTime: { color: "#4C5854", fontSize: 11, fontWeight: "800", marginTop: 10 },
  tileArea: { color: "#7A837F", fontSize: 11, marginTop: 5 },
  tileFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 10 },
  tileSpots: { fontSize: 11, fontWeight: "900" },
  tileArrow: { fontSize: 22, fontWeight: "700" },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#F4F1E8",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { fontSize: 23 },
  pill: {
    backgroundColor: "#E3F2EC",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  pillText: { color: "#247064", fontWeight: "800", fontSize: 12 },
  cardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#17211F",
    marginBottom: 7,
  },
  meta: { fontSize: 14, lineHeight: 21, color: "#68716D" },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  host: { fontSize: 13, fontWeight: "600", color: "#68716D" },
  spotsText: { fontSize: 11, fontWeight: "700", color: "#247064", marginTop: 3 },
  join: {
    backgroundColor: "#E76F51",
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 14,
  },
  joined: { backgroundColor: "#82908B" },
  joinText: { color: "white", fontWeight: "800" },
  nav: {
    height: 70,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E6E6E0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 7,
  },
  navItem: { alignItems: "center", justifyContent: "center", minWidth: 58, height: 52, borderRadius: 17 },
  navItemActive: { backgroundColor: "#EAF4F1" },
  navCreate: { backgroundColor: "#E76F51", width: 52, minWidth: 52, height: 52, borderRadius: 18, marginTop: -22, shadowColor: "#E76F51", shadowOpacity: .25, shadowRadius: 7, elevation: 5 },
  navIcon: { fontSize: 20, color: "#87918D" },
  navCreateIcon: { color: "#FFF", fontSize: 28, lineHeight: 29 },
  navCreateText: { color: "#7B534B", position: "absolute", top: 56 },
  navText: { fontSize: 9, fontWeight: "800", marginTop: 3, color: "#87918D" },
  navActive: { color: "#126957" },
  empty: { marginTop: 70, alignItems: "center", paddingHorizontal: 28 },
  emptyEmoji: { fontSize: 42, marginBottom: 18 },
  primary: {
    backgroundColor: "#247064",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 22,
  },
  primaryText: { color: "white", fontWeight: "800" },
  pending: {
    alignSelf: "flex-start",
    marginTop: 14,
    padding: 9,
    borderRadius: 10,
    backgroundColor: "#FFF1D8",
  },
  pendingText: { fontSize: 12, fontWeight: "700", color: "#8B6226" },
  profile: { alignItems: "center", paddingVertical: 28 },
  bigAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#F0AF49",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
  },
  bigAvatarText: { fontSize: 28, fontWeight: "800" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  safety: {
    backgroundColor: "#E3F2EC",
    borderRadius: 20,
    padding: 18,
    marginTop: 30,
  },
  safetyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#247064",
    marginBottom: 7,
  },
  audience: {
    alignSelf: "flex-start",
    backgroundColor: "#F5E8FF",
    color: "#70408C",
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    marginBottom: 8,
  },
  profileCard: {
    backgroundColor: "#503A82",
    borderRadius: 28,
    padding: 22,
    marginTop: 22,
    overflow: "hidden",
  },
  profileGlow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  verified: {
    backgroundColor: "#DDF7E8",
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  verifiedText: { color: "#176448", fontWeight: "800", fontSize: 12 },
  profileName: { fontSize: 28, fontWeight: "900", color: "white" },
  profileBio: { fontSize: 15, color: "#E8DFFF", marginTop: 5 },
  profileLocation: { fontSize: 13, color: "#D4C9F1", marginTop: 10 },
  profileUsername: { fontSize: 13, color: "#F8C96F", fontWeight: "900", marginTop: 7 },
  profileStats: { flexDirection: "row", backgroundColor: "#FFFFFF", borderRadius: 20, marginTop: 14, paddingVertical: 15, borderWidth: 1, borderColor: "#ECEAE3" },
  profileStat: { flex: 1, alignItems: "center", borderRightWidth: 1, borderRightColor: "#ECEAE3" },
  profileStatValue: { color: "#17211F", fontSize: 20, fontWeight: "900" },
  profileStatLabel: { color: "#7A827F", fontSize: 10, fontWeight: "700", marginTop: 3 },
  qr: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  qrMark: { fontSize: 38, color: "#17211F" },
  qrTitle: { fontSize: 15, fontWeight: "900", color: "#17211F" },
  qrCopy: { fontSize: 11, lineHeight: 16, color: "#68716D", marginTop: 2 },
  colorChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "#FFE5B9",
  },
  colorChipText: { fontWeight: "800", color: "#6A4711" },
  trustBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#E5F5ED",
    padding: 14,
    borderRadius: 18,
    marginBottom: 18,
  },
  trustIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    textAlign: "center",
    textAlignVertical: "center",
    backgroundColor: "#247064",
    color: "white",
    fontWeight: "900",
  },
  trustTitle: { fontSize: 14, fontWeight: "900", color: "#174E45" },
  trustCopy: { fontSize: 12, color: "#55716A", marginTop: 2 },
  tripRules: {
    backgroundColor: "#EEF0FF",
    padding: 10,
    borderRadius: 12,
    marginTop: 12,
  },
  tripRulesText: { fontSize: 11, fontWeight: "700", color: "#4B4F83" },
  tripJoin: { backgroundColor: "#4E56A6" },
  kindRow: { flexDirection: "row", gap: 12 },
  kindCard: {
    flex: 1,
    minHeight: 150,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "#ECEAE3",
    borderRadius: 22,
    padding: 16,
  },
  kindActive: { borderColor: "#247064", backgroundColor: "#F1FAF6" },
  kindEmoji: { fontSize: 27, marginBottom: 13 },
  kindTitle: { fontSize: 16, fontWeight: "900", color: "#17211F" },
  kindCopy: { fontSize: 12, lineHeight: 17, color: "#68716D", marginTop: 5 },
  formRow: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#ECEAE3",
    paddingHorizontal: 13,
  },
  formNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#ECEAE3",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 12,
    fontWeight: "800",
    color: "#59615E",
  },
  formLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#28322F",
    marginLeft: 11,
  },
  formArrow: { fontSize: 24, color: "#8A918E" },
  primaryWide: {
    backgroundColor: "#247064",
    paddingVertical: 16,
    borderRadius: 17,
    alignItems: "center",
    marginTop: 20,
  },
  tripHero: {
    backgroundColor: "#4E56A6",
    borderRadius: 22,
    padding: 18,
    marginTop: 20,
  },
  tripHeroTitle: { fontSize: 21, fontWeight: "900", color: "white" },
  tripHeroText: {
    fontSize: 13,
    lineHeight: 19,
    color: "#E6E8FF",
    marginTop: 7,
  },
  tripWarning: {
    backgroundColor: "#FFF1D8",
    padding: 16,
    borderRadius: 18,
    marginTop: 18,
  },
  tripWarningTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#7B541C",
    marginBottom: 5,
  },
  tripButton: { backgroundColor: "#4E56A6" },
  field: { marginBottom: 13 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4F5955",
    marginBottom: 6,
  },
  input: {
    height: 50,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DDDAD0",
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    color: "#17211F",
  },
  choiceRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  choice: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDDAD0", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  choiceActive: { backgroundColor: "#E2F2EC", borderColor: "#247064" },
  choiceText: { color: "#59615E", fontSize: 13, fontWeight: "800" },
  choiceTextActive: { color: "#174E45" },
  alertPanel: { backgroundColor: "#FFF", borderRadius: 21, borderWidth: 1, borderColor: "#ECEAE3", padding: 14, marginBottom: 20 },
  alertRow: { flexDirection: "row", gap: 10, padding: 11, borderRadius: 14, marginTop: 7 },
  alertUnread: { backgroundColor: "#E8F4EF" },
  alertIcon: { width: 28, height: 28, borderRadius: 10, backgroundColor: "#F0AF49", textAlign: "center", textAlignVertical: "center", fontWeight: "900" },
  alertTitle: { color: "#17211F", fontWeight: "900", fontSize: 14 },
  alertAction: { color: "#247064", fontWeight: "900", fontSize: 12 },
  reminderCard: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FFF1D8", borderRadius: 18, padding: 14, marginBottom: 17 },
  reminderIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#F8C96F", alignItems: "center", justifyContent: "center" },
  reminderIconText: { fontSize: 18 },
  reminderButton: { backgroundColor: "#247064", borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 },
  reminderButtonText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  requiredList: {
    backgroundColor: "#EEF0FF",
    padding: 15,
    borderRadius: 16,
    marginTop: 4,
  },
  requiredTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: "#4E56A6",
    marginBottom: 4,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  accountCode: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: "#503A82",
    marginTop: 3,
  },
  editButton: {
    marginTop: 22,
    borderWidth: 1,
    borderColor: "#503A82",
    paddingVertical: 13,
    borderRadius: 15,
    alignItems: "center",
  },
  editText: { fontWeight: "800", color: "#503A82" },
  trustPanel: { backgroundColor: "#FFFFFF", borderRadius: 21, paddingHorizontal: 16, borderWidth: 1, borderColor: "#ECEAE3" },
  trustRow: { minHeight: 67, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: "#ECEAE3" },
  trustRowIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: "#E8F4EF", textAlign: "center", textAlignVertical: "center", color: "#247064", fontSize: 17, fontWeight: "900" },
  trustRowTitle: { fontSize: 14, fontWeight: "900", color: "#17211F" },
  trustRowValue: { fontSize: 12, color: "#7A827F", marginTop: 2 },
  trustCheck: { fontSize: 20, color: "#B6BCBA", fontWeight: "900" },
  trustCheckDone: { color: "#247064" },
  accountPanel: { backgroundColor: "#FFF1D8", borderRadius: 20, padding: 17 },
  accountLabel: { fontSize: 10, letterSpacing: 1.2, color: "#8B6226", fontWeight: "900" },
  accountValue: { fontSize: 16, color: "#402E12", fontWeight: "900", marginTop: 5 },
  accountHint: { fontSize: 12, color: "#765D37", lineHeight: 18, marginTop: 8, textTransform: "capitalize" },
  signOutButton: { alignItems: "center", paddingVertical: 14, marginTop: 9 },
  signOutText: { color: "#A04437", fontWeight: "800" },
  qrActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  qrAction: {
    flex: 1,
    backgroundColor: "#F0AF49",
    padding: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  qrActionText: { fontWeight: "900", color: "#2C2417" },
  qrActionAlt: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D8CCF5",
    padding: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  qrActionAltText: { fontWeight: "900", color: "white" },
  qrScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  scanner: { flex: 1, backgroundColor: "#000" },
  scanOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 60,
  },
  scanTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "white",
    backgroundColor: "#00000099",
    padding: 12,
    borderRadius: 12,
  },
  scanFrame: {
    width: 245,
    height: 245,
    borderWidth: 4,
    borderColor: "#F0AF49",
    borderRadius: 24,
  },
  scanClose: {
    backgroundColor: "#17211F",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
  },
  smallAdd: {
    backgroundColor: "#247064",
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 14,
  },
  genderBox: {
    backgroundColor: "#E3F2EC",
    padding: 15,
    borderRadius: 18,
    marginBottom: 16,
  },
  rateText: { color: "#70408C", fontWeight: "800" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 15,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#ECEAE3",
  },
  toggle: {
    width: 46,
    height: 27,
    borderRadius: 14,
    backgroundColor: "#C9CECC",
    padding: 3,
  },
  toggleOn: { backgroundColor: "#247064" },
  toggleDot: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: "#FFF",
  },
  toggleDotOn: { marginLeft: 19 },
  manageButton: {
    backgroundColor: "#503A82",
    paddingHorizontal: 17,
    paddingVertical: 11,
    borderRadius: 14,
  },
  reviewBox: {
    backgroundColor: "#FFF1D8",
    padding: 16,
    borderRadius: 18,
    marginVertical: 18,
  },
  restrictedBox: { backgroundColor: "#F9D9D5" },
  miniButton: {
    borderWidth: 1,
    borderColor: "#503A82",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
  },
  dangerButton: {
    backgroundColor: "#B94A3B",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  memberRow: {
    backgroundColor: "#FFF",
    borderRadius: 17,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#ECEAE3",
  },
  memberActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  approveButton: {
    backgroundColor: "#247064",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
});
