// server.js
import express from "express";
import { classifyInputsV2 } from "./openai-v2.js";

const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️ Falta OPENAI_API_KEY");
}

/* ------------------------------- Utilidades Podio ------------------------------- */
async function getFreshPodioToken() {
    const resp = await fetch(
        `https://${process.env.PROJECT_REF}.functions.supabase.co/get-podio-token`,
        {
            headers: {
                Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
                apikey: process.env.SUPABASE_ANON_KEY,
            },
        }
    );
    if (!resp.ok) throw new Error(`get-podio-token failed: ${resp.status}`);
    const data = await resp.json();
    return data.access_token;
}

async function podioJson(url, init = {}) {
    const resp = await fetch(url, {
        ...init,
        headers: {
            Authorization: `OAuth2 ${await getFreshPodioToken()}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
            `Podio ${init.method || "GET"} ${url} => ${resp.status} ${
                resp.statusText
            } :: ${text}`
        );
    }
    return resp.json();
}

async function podioRaw(url, init = {}) {
    const resp = await fetch(url, {
        ...init,
        headers: {
            Authorization: `OAuth2 ${await getFreshPodioToken()}`,
            ...(init.headers || {}),
        },
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
            `Podio ${init.method || "GET"} ${url} => ${resp.status} ${
                resp.statusText
            } :: ${text}`
        );
    }
    return Buffer.from(await resp.arrayBuffer());
}

/** Lista archivos del ítem */
async function listItemFiles(itemId) {
    const url = `https://api.podio.com/item/${itemId}/file/`;
    const files = await podioJson(url);
    return files.map((f) => ({
        file_id: f.file_id,
        name: f.name,
        mimetype: f.mimetype || f.mime_type || "",
        link: f.link,
    }));
}

/** Descarga binario + metadatos */
async function fetchFileBufferWithInfo(fileId) {
    const meta = await podioJson(`https://api.podio.com/file/${fileId}`);
    const buffer = await podioRaw(
        `https://api.podio.com/file/${fileId}/raw`
    );
    return {
        filename: meta.name || `file-${fileId}`,
        mime: meta.mimetype || meta.mime_type || "application/octet-stream",
        buffer,
    };
}

/* ---------------------------- Mapeo de salida a Podio --------------------------- */
async function updatePodioItemFields(itemId, data) {
    const payload = {
        fields: {
            nombre_corto: data.nombre_corto,
            descripcion: data.descripcion,
            fraccion: data.fraccion,
            justificacion: data.justificacion,
            alternativas: Array.isArray(data.alternativas)
                ? data.alternativas.join("\n")
                : String(data.alternativas),
            notas_clasificador: data.notas,
            regulacion: data.regulacion,
            arbol: data.arbol,
            dudas_cliente: data.dudas,
            fecha: new Date().toISOString().slice(0, 10),
        },
    };

    const url = `https://api.podio.com/item/${itemId}`;
    const resp = await fetch(url, {
        method: "PUT",
        headers: {
            Authorization: `OAuth2 ${await getFreshPodioToken()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.error("❌ Falló updatePodioItemFields:", resp.status, t);
    }
}

/* ------------------------------- Flujo principal ------------------------------- */
async function classifyPodioItem(itemId) {
    const metas = await listItemFiles(itemId);
    console.log(`📎 Ítem ${itemId} tiene ${metas.length} archivo(s)`);

    const files = [];
    for (const m of metas) {
        try {
            const f = await fetchFileBufferWithInfo(m.file_id);
            files.push(f);
        } catch (e) {
            console.warn(`⚠️ No se pudo bajar archivo ${m.file_id}:`, e.message);
        }
    }

    const result = await classifyInputsV2({ text: "", files });
    console.log("🧾 Resultado v2:", result);

    await updatePodioItemFields(itemId, result);

    return result;
}

/* ---------------------------------- Rutas API ---------------------------------- */
const app = express();
app.use(express.json({ limit: "25mb" }));

// Health
app.get("/healthz", (_req, res) =>
    res.json({ ok: true, ts: new Date().toISOString() })
);

// Debug: listar archivos
app.get("/debug/item-files", async (req, res) => {
    try {
        const itemId = req.query.item_id;
        if (!itemId)
            return res.status(400).json({ ok: false, error: "Falta item_id" });
        const files = await listItemFiles(itemId);
        res.json({ ok: true, count: files.length, files });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// Debug: clasificar con base64
app.post("/debug/classify-v2", async (req, res) => {
    try {
        const { text = "", files = [] } = req.body;
        const norm = (files || []).map((f) => ({
            filename: f.filename,
            mime: f.mime,
            buffer: Buffer.from(f.base64, "base64"),
        }));
        const result = await classifyInputsV2({ text, files: norm });
        res.json({ ok: true, result });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// Unified webhook handler
app.post("/podio-hook", async (req, res) => {
    console.log(
        "📩 Incoming webhook body:",
        JSON.stringify(req.body).slice(0, 500)
    );

    // Handle handshake verify
    if (req.body?.type === "hook.verify" && req.body?.code) {
        console.log("🔑 Responding with verify code:", req.body.code);
        return res.status(200).send(req.body.code);
    }

    // Handle item.create notifications
    if (req.body?.type === "item.create") {
        console.log(
            "🆕 Item create received for:",
            req.body.item_id || req.body.data?.item_id
        );
    }

    // Handle classification (direct call with item_id)
    const { item_id } = req.body || {};
    if (item_id) {
        try {
            const result = await classifyPodioItem(item_id);
            return res.json({ ok: true, item_id, result });
        } catch (e) {
            console.error("❌ /podio-hook error:", e);
            return res.status(500).json({ ok: false, error: String(e) });
        }
    }

    res.json({ ok: true });
});

// Debug: live Podio token
app.get("/debug/token", async (_req, res) => {
    try {
        const tok = await getFreshPodioToken();
        res.json({ PODIO_TOKEN: tok.slice(0, 8) + "...", ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Node filler v2 on http://localhost:${PORT}`);
});
