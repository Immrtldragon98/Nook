import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const { identifier, password } = await req.json();
    if (typeof identifier !== "string" || typeof password !== "string")
      throw new Error("Invalid credentials");
    const url = Deno.env.get("SUPABASE_URL")!;
    let email = identifier.trim().toLowerCase();
    if (!email.includes("@")) {
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data } = await admin.from("login_handles").select("email")
        .eq("username", email).maybeSingle();
      if (!data) throw new Error("Invalid credentials");
      email = data.email;
    }
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error("Invalid credentials");
    return new Response(JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }), { headers });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return new Response(JSON.stringify({ error: "Invalid username/email or password" }),
      { status: 401, headers });
  }
});
