import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({error:"Method not allowed"}), {status:405,headers});
  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: identityError } = await caller.auth.getUser();
    if (identityError || !user) return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401, headers });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // User-owned database content is removed atomically by the auth deletion
    // trigger. Do not delete plans/groups in separate requests before this.
    const { data: avatarFiles, error: listError } = await admin.storage.from("avatars").list(user.id, { limit:100 });
    if (listError) throw listError;
    if (avatarFiles?.length) {
      const { error: storageError } = await admin.storage.from("avatars").remove(avatarFiles.map((file) => `${user.id}/${file.name}`));
      if (storageError) throw storageError;
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch (error) {
    console.error("delete-account failed", error);
    return new Response(JSON.stringify({ error: "Account could not be deleted" }), { status: 500, headers });
  }
});
