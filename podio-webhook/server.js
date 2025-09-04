import express from "express";
import bodyParser from "body-parser";
import { spawn } from "child_process";

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PODIO_ACCESS_TOKEN = process.env.PODIO_ACCESS_TOKEN || "";
const FILLER_NODE_ENTRY = process.env.FILLER_NODE_ENTRY || "/Users/jandrofdza/Projects/podio-pipeline/podio-cli/server.js";
const FILLER_NODE_RUNNER = process.env.FILLER_NODE_RUNNER || "node";

if (!PODIO_ACCESS_TOKEN) console.warn("⚠️  PODIO_ACCESS_TOKEN not set");
if (!FILLER_NODE_ENTRY) console.warn("⚠️  FILLER_NODE_ENTRY not set");

// ---- simple in-memory de-dupe with TTL ----
const seen = new Map(); // key -> timestamp
const TTL_MS = 60_000;  // collapse duplicates within 60s

function makeKey(body) {
  const hook = body.hook_id || "nohook";
  const id = body.item_id || body.itemId || "noid";
  const rev = body.item_revision_id ?? "norev";
  return `${hook}:${id}:${rev}`;
}
function isDuplicate(key) {
  const now = Date.now();
  // cleanup old
  for (const [k, t] of seen) if (now - t > TTL_MS) seen.delete(k);
  const last = seen.get(key);
  if (last && now - last < TTL_MS) return true;
  seen.set(key, now);
  return false;
}

// ---- spawn your existing filler (fire-and-forget) ----
function runExistingFiller(itemId) {
  console.log("🛠  Spawning filler:", FILLER_NODE_RUNNER, FILLER_NODE_ENTRY, "(ITEM_ID:", String(itemId), ")");
  const child = spawn(FILLER_NODE_RUNNER, [FILLER_NODE_ENTRY], {
    stdio: "inherit",
    env: { ...process.env, PODIO_ACCESS_TOKEN, ITEM_ID: String(itemId) },
  });
  child.on("exit", (code) => {
    if (code === 0) console.log("✅ Filler exited successfully");
    else console.error("❌ Filler exited with code", code);
  });
}

// ---- webhook handler ----
app.post("/podio-hook", (req, res) => {
  try {
    // handshake
    if (req.body?.type === "hook.verify" && req.body?.code) {
      console.log("🔐 Podio hook.verify received. CODE =", req.body.code);
      return res.status(200).send("Verification ping OK");
    }
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log("🔐 Podio verification request received (empty body)");
      return res.status(200).send("Verification OK");
    }

    console.log("✅ Webhook triggered!");
    console.log("📦 Body received:", req.body);

    const itemId = req.body.item_id || req.body.itemId;
    if (!itemId) return res.status(200).send("ok"); // be nice: ack but do nothing

    // de-dupe
    const key = makeKey(req.body);
    if (isDuplicate(key)) {
      console.log("⏭️  Skipping duplicate within TTL:", key);
      return res.status(200).send("duplicate");
    }

    // respond immediately so Podio doesn't retry
    res.status(202).json({ status: "queued", itemId: String(itemId) });

    // process async
    runExistingFiller(itemId);
  } catch (err) {
    console.error("❌ Error handling webhook:", err?.response?.data || err.message);
    res.status(200).send("ok"); // ack to avoid retries even on unexpected errors
  }
});

app.get("/", (_req, res) => res.send("Podio webhook listener is running!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on http://localhost:${PORT}`);
  console.log(`➡️  Using filler entry: ${FILLER_NODE_ENTRY}`);
});
// === DEBUG routes ===
app.get('/healthz', (_req, res) => {
  res.status(200).send('ok :: debug routes mounted');
});

app.get('/debug/item-files', async (req, res) => {
  const item_id = Number(req.query.item_id);
  if (!item_id) return res.status(400).json({ error: 'missing item_id' });
  try {
    const { fetchPodioFiles } = await import('./helpers/podio.js');
    const files = await fetchPodioFiles(item_id);
    res.json({
      item_id,
      count: files.length,
      files: files.map(f => ({
        file_id: f.file_id, name: f.name, mimetype: f.mimetype, size: f.size
      }))
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
// === end DEBUG routes ===
