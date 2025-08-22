import { createClient } from "https://esm.sh/@supabase/supabase-js@2"\;
import OpenAI from "npm:openai";

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

Deno.serve(async () => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });

  try {
    // claim next queued job
    const { data: jobs, error: jerr } = await sb.from("jobs")
      .select("*").eq("status","queued").order("created_at",{ ascending:true }).limit(1);
    if (jerr) throw jerr;
    if (!jobs?.length) return new Response("No queued jobs", { status: 200 });
    const job = jobs[0];
    await sb.from("jobs").update({ status:"processing" }).eq("id", job.id);

    // get item → files[]
    const { access_token } = await getPodioToken();
    const itemResp = await fetch(`https://api.podio.com/item/${job.podio_item_id}`, {
      headers: { Authorization: `OAuth2 ${access_token}` }
    });
    if (!itemResp.ok) throw new Error(`Podio get item: ${itemResp.status} ${await itemResp.text()}`);
    const item = await itemResp.json();
    const files = Array.isArray(item.files) ? item.files : [];

    // download each file and upload to Supabase Storage
    const rows: any[] = [];
    for (const f of files) {
      const fileId = f.file_id ?? f.file?.file_id ?? f.id;
      const name = f.name ?? f.file_name ?? `podio_file_${fileId}`;
      const mime = f.mimetype ?? f.mime_type ?? "application/octet-stream";

      const metaResp = await fetch(`https://api.podio.com/file/${fileId}`, {
        headers: { Authorization: `OAuth2 ${access_token}` }
      });
      if (!metaResp.ok) throw new Error(`file meta ${fileId}: ${metaResp.status} ${await metaResp.text()}`);
      const meta = await metaResp.json();
      const fileUrl = (meta.link || `https://files.podio.com/${fileId}`) + `?oauth_token=${access_token}`;

      const bin = await fetch(fileUrl);
      if (!bin.ok) throw new Error(`file download ${fileId}: ${bin.status} ${await bin.text()}`);
      const arr = new Uint8Array(await bin.arrayBuffer());

      const storage_path = `${job.podio_item_id}/${name}`;
      const up = await sb.storage.from("podio_uploads").upload(storage_path, arr, {
        contentType: mime, upsert: true
      });
      if (up.error) throw up.error;

      rows.push({ job_id: job.id, podio_file_id: fileId, file_name: name, mime, storage_path, size_bytes: arr.byteLength });
    }
    if (rows.length) {
      const { error } = await sb.from("files").insert(rows);
      if (error) throw error;
    }

    // GPT classification (baseline)
    const summary = rows.map(r => `${r.file_name} (${r.mime}, ${r.size_bytes} bytes)`).join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Eres un clasificador aduanal experto en comercio exterior mexicano. Devuelve JSON válido." },
        { role: "user", content: `Datos del webhook:\n${JSON.stringify(job.payload)}\n\nArchivos:\n${summary}\n\nDevuelve JSON: { fraccion_arancelaria, umc, pais_origen, riesgos, notas }` }
      ],
      response_format: { type: "json_object" }
    });
    const parsed = JSON.parse(completion.choices[0].message?.content || "{}");

    await sb.from("results").upsert({ job_id: job.id, model_version:"gpt-4o-mini", raw_json: parsed });
    await sb.from("jobs").update({ status:"done" }).eq("id", job.id);

    // post a comment back to Podio (best-effort)
    try {
      const { access_token: t2 } = await getPodioToken();
      await fetch(`https://api.podio.com/comment/item/${job.podio_item_id}/`, {
        method: "POST",
        headers: { Authorization: `OAuth2 ${t2}`, "Content-Type":"application/json" },
        body: JSON.stringify({ value: "Clasificación automática:\n```json\n" + JSON.stringify(parsed, null, 2) + "\n```" }),
      });
    } catch(e) { console.error("comment failed:", e); }

    return new Response("ok", { status: 200 });
  } catch (e: any) {
    console.error("worker error:", e?.message || e);
    await sb.from("jobs").update({ status:"error", error: String(e?.message || e) }).eq("status","processing");
    return new Response("error", { status: 500 });
  }
});
