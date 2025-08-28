// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function env(k: string) {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}

type PodioToken = { access_token: string };
type PodioField = { field_id: number; type: string; external_id?: string; label?: string };

const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

async function getPodioToken(): Promise<PodioToken> {
  const body = new URLSearchParams({
    grant_type: "app",
    client_id: env("PODIO_CLIENT_ID"),
    client_secret: env("PODIO_CLIENT_SECRET"),
    app_id: env("PODIO_APP_ID"),
    app_token: env("PODIO_APP_TOKEN"),
  });
  const r = await fetch("https://api.podio.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Podio auth ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function getAppFields(appId: string, token: string): Promise<PodioField[]> {
  const r = await fetch(`https://api.podio.com/app/${appId}`, {
    headers: { Authorization: `OAuth2 ${token}` },
  });
  if (!r.ok) throw new Error(`getAppFields ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (!Array.isArray(j.fields)) throw new Error("App response missing .fields[]");
  return j.fields as PodioField[];
}

async function putField(itemId: number, fieldId: number, value: string, token: string) {
  const url = `https://api.podio.com/item/${itemId}/value/${fieldId}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `OAuth2 ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!r.ok) throw new Error(`PUT field_id=${fieldId} → ${r.status} ${await r.text()}`);
}

function norm(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function pick(fields: PodioField[]) {
  const byExt: Record<string, PodioField> = {};
  const byLabel: Record<string, PodioField> = {};
  for (const f of fields) {
    if (f.external_id) byExt[norm(f.external_id)] = f;
    if (f.label) byLabel[norm(f.label)] = f;
  }
  const findText = (cands: string[]) =>
    cands.map(c => byExt[norm(c)] || byLabel[norm(c)]).find(f => f && f.type === "text");

  return {
    fraccion: findText(["fraccion-2","fraccion arancelaria","fraccion-arancelaria","fraccion"]),
    analisis: findText(["analisis","descripcion-tecnica","descripcion","alternativas"]),
    criterio: findText(["criterio-tlc","criterio tlc","criterio"]),
    notas:    findText(["notas-del-clasificador","notas","comentarios"]),
  };
}

const SCHEMA = {
  name: "ClasificacionPodio",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      fraccion_arancelaria: { type: "string" },
      descripcion_tecnica:  { type: "string" },
      criterio_tlc:         { type: "string" },
      notas_del_clasificador: { type: "string" },
    },
    required: ["fraccion_arancelaria","descripcion_tecnica","criterio_tlc","notas_del_clasificador"],
  },
  strict: true,
} as const;

async function classify(files: any[]) {
  const messages = [
    {
      role: "system",
      content:
        "Eres un clasificador aduanal experto. Devuelve SOLO el JSON solicitado, sin claves extra.",
    },
    {
      role: "user",
      content:
        "Rellena los campos del reporte de Podio usando los documentos adjuntos. " +
        "Claves válidas: fraccion_arancelaria, descripcion_tecnica, criterio_tlc, notas_del_clasificador. " +
        "NO incluyas: umc, riesgos, pais_origen, etc.\n\n" +
        `Archivos: ${JSON.stringify(files).slice(0, 3000)}`,
    },
  ];

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    response_format: { type: "json_schema", json_schema: SCHEMA },
    temperature: 0.2,
  });

  const raw = resp.choices[0]?.message?.content || "{}";
  return JSON.parse(raw) as {
    fraccion_arancelaria?: string;
    descripcion_tecnica?: string;
    criterio_tlc?: string;
    notas_del_clasificador?: string;
  };
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const { data: job } = await sb
      .from("jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (!job) return new Response("No queued jobs");
    await sb.from("jobs").update({ status: "processing" }).eq("id", job.id);

    const files: any[] = [];

    const token = (await getPodioToken()).access_token;
    const fields = await getAppFields(env("PODIO_APP_ID"), token);
    const map = pick(fields);

    const out = await classify(files);

    const itemId = Number(job.podio_item_id);
    if (out.fraccion_arancelaria && map.fraccion) {
      await putField(itemId, map.fraccion.field_id, out.fraccion_arancelaria, token);
    }
    if (out.descripcion_tecnica && map.analisis) {
      await putField(itemId, map.analisis.field_id, out.descripcion_tecnica, token);
    }
    if (out.criterio_tlc && map.criterio) {
      await putField(itemId, map.criterio.field_id, out.criterio_tlc, token);
    }
    if (out.notas_del_clasificador && map.notas) {
      await putField(itemId, map.notas.field_id, out.notas_del_clasificador, token);
    }

    await sb.from("results").upsert({
      job_id: job.id,
      model_version: "gpt-4o-mini",
      raw_json: out,
    });

    await sb.from("jobs").update({ status: "done" }).eq("id", job.id);
    return new Response("ok");
  } catch (e: any) {
    console.error("worker error:", e?.message || e);
    try {
      await sb.from("jobs").update({ status: "error", error: String(e?.message || e) }).eq("status", "processing");
    } catch {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
