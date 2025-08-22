import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
serve(async () => {
  const must = ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","PODIO_CLIENT_ID","PODIO_CLIENT_SECRET","PODIO_APP_ID","PODIO_APP_TOKEN"];
  const env: Record<string, boolean> = Object.fromEntries(must.map(k => [k, !!Deno.env.get(k)]));
  let db = { ok:false, rows:0, err:null as null|string };
  let podio = { ok:false, err:null as null|string };
  try {
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data, error } = await sb.from("jobs").select("id").limit(1);
      db.ok = !error; db.rows = data?.length ?? 0; if (error) db.err = error.message;
    } else db.err = "Missing SB envs";
  } catch (e:any) { db.err = String(e?.message||e); }
  try {
    if (env.PODIO_CLIENT_ID && env.PODIO_CLIENT_SECRET && env.PODIO_APP_ID && env.PODIO_APP_TOKEN) {
      const form = new URLSearchParams({
        grant_type:"app",
        client_id:Deno.env.get("PODIO_CLIENT_ID")!,
        client_secret:Deno.env.get("PODIO_CLIENT_SECRET")!,
        app_id:Deno.env.get("PODIO_APP_ID")!,
        app_token:Deno.env.get("PODIO_APP_TOKEN")!
      });
      const r = await fetch("https://api.podio.com/oauth/token",{ method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded" }, body: form.toString()});
      podio.ok = r.ok; if (!r.ok) podio.err = await r.text();
    } else podio.err = "Missing Podio envs";
  } catch (e:any) { podio.err = String(e?.message||e); }
  return new Response(JSON.stringify({ env, db, podio, ts: Date.now() }), { headers: { "Content-Type": "application/json" }});
});
