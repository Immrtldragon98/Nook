import { supabase } from "./supabase";

export type CloudGroup = {
  id: string;
  host_id: string;
  title: string;
  category: string;
  city: string;
  area: string;
  language: string;
  description: string;
  women_only: boolean;
  trusted_only: boolean;
  created_at: string;
};
export type CloudRequest = {
  group_id: string;
  user_id: string;
  status: string;
  created_at: string;
  display_name: string;
};

export async function initializeCloudIdentity(profile: {
  name: string;
  city: string;
  zone: string;
  languages: string;
  interests: string;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const profileRow = {
    id: user.id,
    display_name: profile.name,
    city: profile.city,
    area: profile.zone,
    languages: profile.languages
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    interests: profile.interests
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  };
  const profileResult = await supabase.from("profiles").upsert(profileRow);
  if (profileResult.error) throw profileResult.error;
  const trustResult = await supabase.from("trust_assertions").insert({
    user_id: user.id,
    adult_verified: false,
    woman_verified: false,
    face_verified: false,
    attended_plans: 0,
  });
  if (trustResult.error && trustResult.error.code !== "23505")
    throw trustResult.error;
  const roleResult = await supabase
    .from("user_roles")
    .insert({ user_id: user.id, role: "member" });
  if (roleResult.error && roleResult.error.code !== "23505")
    throw roleResult.error;
}

export async function listCloudGroups(city: string) {
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("city", city)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CloudGroup[];
}
export async function createCloudGroup(
  group: Omit<CloudGroup, "id" | "host_id" | "created_at">,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const { data, error } = await supabase
    .from("groups")
    .insert({ ...group, host_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return data as CloudGroup;
}
export async function requestCloudMembership(groupId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const { error } = await supabase
    .from("memberships")
    .insert({ group_id: groupId, user_id: user.id, status: "pending" });
  if (error) throw error;
}
export async function listCloudHostRequests(groupId: string) {
  const { data, error } = await supabase
    .from("memberships")
    .select("group_id,user_id,status,created_at")
    .eq("group_id", groupId);
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((x) => x.user_id);
  if (!ids.length) return [] as CloudRequest[];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,display_name")
    .in("id", ids);
  if (profileError) throw profileError;
  return rows.map((row) => ({
    ...row,
    display_name:
      profiles?.find((p) => p.id === row.user_id)?.display_name ??
      "Nook member",
  })) as CloudRequest[];
}
export async function decideCloudMembership(
  groupId: string,
  userId: string,
  status: "approved" | "rejected" | "removed" | "blocked",
) {
  const { error } = await supabase
    .from("memberships")
    .update({ status })
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw error;
}
export async function submitCloudSafetyRating(groupId: string, rating: number) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const { error } = await supabase
    .from("safety_ratings")
    .insert({ group_id: groupId, user_id: user.id, rating });
  if (error) throw error;
}
export async function submitCloudReport(groupId: string, reason: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const { error } = await supabase
    .from("reports")
    .insert({ group_id: groupId, reporter_id: user.id, reason });
  if (error) throw error;
}
export async function currentCloudUserId() {
  return (await supabase.auth.getUser()).data.user?.id ?? null;
}
export function watchCloudGroups(onChange: () => void) {
  const channel = supabase
    .channel("nook-groups")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "groups" },
      onChange,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
