
const app = express();

// Parse JSON and x-www-form-urlencoded (Podio sends urlencoded for hook.verify)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🪝 Podio webhook endpoint
app.post("/podio-hook", async (req, res) => {
  try {
    // Podio verification handshake: type=hook.verify&code=XXXX (urlencoded)
    if (req.body?.type === "hook.verify" && req.body?.code) {
      console.log("🔐 Podio hook.verify received. CODE =", req.body.code);
      return res.status(200).send("Verification ping OK");
    }

    // Old-style “empty body” verification ping
    if (!req.body || Object.keys(req.body).length === 0) {
      console.log("🔐 Podio verification request received (empty body)");
      return res.status(200).send("Verification OK");
    }

    console.log("✅ Webhook triggered!");
    console.log("📦 Body received:", req.body);

    // Podio sends item_id for item events
    const itemId = req.body.item_id || req.body.itemId;
    if (!itemId) {
      console.error("❌ No itemId in webhook body");
      return res.status(400).json({ error: "Missing itemId" });
    }

    console.log(`🎯 Processing Podio item: ${itemId}`);

    // 👉 Your filler logic goes here (download files, GPT, update Podio)
    // await runFiller(itemId);

    return res.json({ status: "ok", itemId });
  } catch (err) {
    console.error("❌ Error handling webhook:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Healthcheck
app.get("/", (req, res) => {
  res.send("Podio webhook listener is running!");
});

// Start server
  console.log(`🚀 Webhook server listening on http://localhost:${PORT}`);
});
