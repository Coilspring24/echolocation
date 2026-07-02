import express from "express";
import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TRIGGER_TTL_MS = Number(process.env.TRIGGER_TTL_MS) || 10000;

// --- Anchor config ---
const ANCHORS = {
  anchor_1: { topic: "anchor_1/play", note: "C6", freq: 1046.5 },
  anchor_2: { topic: "anchor_2/play", note: "E6", freq: 1318.5 },
  anchor_3: { topic: "anchor_3/play", note: "G6", freq: 1568.0 },
};

// --- In-memory trigger tracking ---
// Maps anchor_id -> { triggeredAt, expiresAt }
const activeTriggers = new Map();

function isTriggerValid(anchorId) {
  const trigger = activeTriggers.get(anchorId);
  if (!trigger) return false;
  return Date.now() <= trigger.expiresAt;
}

// --- MQTT client setup ---
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  reconnectPeriod: 2000,
});

mqttClient.on("connect", () => {
  console.log("[mqtt] connected to broker");
});

mqttClient.on("error", (err) => {
  console.error("[mqtt] connection error:", err.message);
});

mqttClient.on("reconnect", () => {
  console.log("[mqtt] reconnecting...");
});

// --- Routes ---

// POST /tone/trigger
// body: { "anchor_id": "anchor_1" }
app.post("/tone/trigger", (req, res) => {
  const { anchor_id } = req.body;

  const anchor = ANCHORS[anchor_id];
  if (!anchor) {
    return res.status(400).json({ error: `Unknown anchor_id: ${anchor_id}` });
  }

  if (!mqttClient.connected) {
    return res.status(503).json({ error: "MQTT broker not connected" });
  }

  mqttClient.publish(anchor.topic, "play", { qos: 1 }, (err) => {
    if (err) {
      console.error(`[mqtt] publish failed for ${anchor.topic}:`, err.message);
      return res.status(500).json({ error: "Failed to publish trigger" });
    }

    const triggeredAt = Date.now();
    activeTriggers.set(anchor_id, {
      triggeredAt,
      expiresAt: triggeredAt + TRIGGER_TTL_MS,
    });

    console.log(`[trigger] ${anchor_id} -> ${anchor.topic} (${anchor.note})`);
    res.json({
      status: "triggered",
      anchor_id,
      topic: anchor.topic,
      note: anchor.note,
      expires_in_ms: TRIGGER_TTL_MS,
    });
  });
});

// POST /presence/report
// body: { "anchor_id": "anchor_1", "detected": true, "confidence": 0.87 }
app.post("/presence/report", (req, res) => {
  const { anchor_id, detected, confidence } = req.body;

  if (!ANCHORS[anchor_id]) {
    return res.status(400).json({ error: `Unknown anchor_id: ${anchor_id}` });
  }

  const validTrigger = isTriggerValid(anchor_id);

  const report = {
    anchor_id,
    detected: Boolean(detected),
    confidence: confidence ?? null,
    valid_trigger: validTrigger,
    reported_at: new Date().toISOString(),
  };

  console.log("[report]", report);

  // MVP: just log/return. Swap in real storage later if needed.
  res.json({ status: "received", ...report });
});

// Basic health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    mqtt_connected: mqttClient.connected,
  });
});

app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
