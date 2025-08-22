import { createClient } from "https://esm.sh/@supabase/supabase-js@2"\;

async function getPodioToken() {
  const form = new URLSearchParams({
    grant_type: "app",
    client_id: Deno.env.get("PODIO_CLIENT_ID")!,
    client_secret: Deno.env.get("PODIO_CLIENT_SECRET")!,
    app_id: Deno.env.get("PODIO_APP_ID")!,
    app_token: Deno.env.get("PODIO_APP_TOKEN")!,
  });
  const r = await fetch("https://api.podio.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!r.ok) throw new Error(`Podio auth: ${r.status} ${await r.text()}`);
  return await r.json() as { access_token: string };
}

Deno.serve(async (req) => {
  try {
    // shared-secret guard (header OR ?secret=)
    const expected = Deno.env.get("WEBHOOK_SECRET");
    const urlSecret = new URL(req.url).searchParams.get("secret");
    const headerSecret = req.headers.get("x-webhook-secret");
    if (expected && expected !== (headerSecret || urlSecret)) {
      return new Response("forbidden", { status: 403 });
    }

    let body: any = {};
    try { body = await req.json(); } catch {}

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Podio webhook verify handshake
    if (body?.type === "hook.verify" && body?.code) {
      const hookId = body?.hook_id || req.headers.get("x-podio-hook-id") || req.headers.get("X-Podio-Hook-Id");
      if (!hookId) {
        return new Response(JSON.stringify({ error: "Missing hook_id" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const { access_token } = await getPodioToken();
      const v = await fetch(`https://api.podio.com/hook/${hookId}/verify/validate`, {
        method: "POST",
        headers: { Authorization: `OAuth2 ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: body.code }),
      });
      if (!v.ok) {
        return new Response(JSON.stringify({ error: `validate failed: ${await v.text()}` }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ verified: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const podio_item_id =
      body?.item_id ?? body?.item?.item_id ?? body?.data?.item_id ?? body?.data?.item?.item_id;
    const intake_app_id = body?.app_id ?? body?.item?.app_id ?? body?.data?.app_id ?? null;
    if (!podio_item_id) {
      return new Response(JSON.stringify({ error: "Missing item_id" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const { data, error } = await sb.from("jobs").insert({
      podio_item_id, intake_app_id, status: "queued", source: "podio", payload: body
    }).select("id").single();
    if (error) throw error;

    return new Response(JSON.stringify({ job_id: data.id, status: "queued" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
