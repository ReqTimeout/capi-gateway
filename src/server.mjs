// CAPI Gateway — naive Node http, TANPA framework (payload kecil, gampang audit).
// POST /sgb/wa → Meta CAPI (Lead) + ingest lead ke dashboard SGB.
// POST /sgb/meta → event Meta generik. POST /sgb/google → stub (tunggu kredensial Ads P9).
// Auth: header X-Client-Key per tenant. Rate limit 60/mnt/IP (memory).
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 4333);
const HOST = process.env.HOST ?? "0.0.0.0";

const CLIENT_KEYS = (process.env.CLIENT_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const META_PIXEL_ID = process.env.META_PIXEL_ID ?? "";
const META_SYS_TOKEN = process.env.META_SYS_TOKEN ?? "";
const META_TEST_CODE = process.env.META_TEST_CODE ?? ""; // test_event_code — kosongkan di produksi
const SGB_URL = (process.env.SGB_URL ?? "").replace(/\/$/, "");
const SGB_INGEST_KEY = process.env.SGB_INGEST_KEY ?? "";

const hits = new Map();

function rateOk(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= 60) return false;
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8").slice(0, 32_000);
  return raw ? JSON.parse(raw) : {};
}

async function sendMetaCapi(event) {
  const payload = { data: [event] };
  if (META_TEST_CODE) payload.test_event_code = META_TEST_CODE;
  const r = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${META_SYS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  return { http: r.status, body };
}

async function pushLeadIngest(lead) {
  if (!SGB_URL || !SGB_INGEST_KEY) return { skipped: true };
  const r = await fetch(`${SGB_URL}/api/ingest/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Key": SGB_INGEST_KEY },
    body: JSON.stringify({ events: [lead] }),
  });
  const t = await r.text();
  return { http: r.status, ok: r.ok, body: t.slice(0, 200) };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true, app: "capi-gateway" });

  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || "?";
  if (!rateOk(ip)) return json(res, 429, { ok: false, error: "rate_limited" });

  if (req.method === "POST" && (url.pathname === "/sgb/wa" || url.pathname === "/sgb/meta")) {
    const key = req.headers["x-client-key"]?.toString() ?? "";
    if (!CLIENT_KEYS.includes(key)) return json(res, 403, { ok: false, error: "bad_client_key" });
    let body = null;
    try { body = await readJson(req); } catch { return json(res, 400, { ok: false, error: "bad_json" }); }

    const isWa = url.pathname === "/sgb/wa";
    const eventId = (body.event_id || randomUUID()).slice(0, 64);
    const eventTime = body.event_time || Math.floor(Date.now() / 1000);
    const event = {
      event_name: isWa ? "Lead" : (body.event_name || "Lead").slice(0, 64),
      event_time: eventTime,
      event_id: eventId,
      event_source_url: (body.page_url || "").slice(0, 512),
      action_source: "website",
      user_data: {
        ...(body.fbc ? { fbc: String(body.fbc).slice(0, 128) } : {}),
        ...(body.fbp ? { fbp: String(body.fbp).slice(0, 128) } : {}),
        ...(body.phone_hash ? { ph: [String(body.phone_hash).slice(0, 64)] } : {}),
        ...(ip && ip !== "?" ? { client_ip_address: ip.slice(0, 64) } : {}),
        ...((body.ua || req.headers["user-agent"]) ? { client_user_agent: String(body.ua || req.headers["user-agent"]).slice(0, 256) } : {}),
      },
    };

    let meta = { skipped: !META_PIXEL_ID || !META_SYS_TOKEN };
    if (!meta.skipped) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          meta = await sendMetaCapi(event);
          if (meta.http < 500) break;
        } catch (e) {
          meta = { error: String(e).slice(0, 200), attempt };
        }
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }

    let ingest = { skipped: true };
    if (isWa) {
      try {
        ingest = await pushLeadIngest({
          ts: new Date(eventTime * 1000).toISOString(),
          type: "wa_click",
          page_url: event.event_source_url,
          source: body.source || "web",
          event_id: eventId,
        });
      } catch (e) { ingest = { error: String(e).slice(0, 200) }; }
    }

    // Google Enhanced Conversions: AKTIF setelah kredensial Ads ada (P9). Struktur siap.
    const google = { status: "pending_creds", note: "butuh Google Ads conversion ID + label (P9)" };
    return json(res, 200, { ok: true, event_id: eventId, meta, ingest, google });
  }

  if (req.method === "POST" && url.pathname === "/sgb/google") {
    return json(res, 501, { ok: false, error: "pending_creds", note: "butuh kredensial Google Ads (P9)" });
  }
  return json(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, HOST, () => console.log(`capi-gateway on ${HOST}:${PORT}`));
