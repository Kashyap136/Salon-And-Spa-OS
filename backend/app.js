require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dns = require("dns");
const path = require("path");

const app = express();

// Indexes are built explicitly during start() (see db.js) after legacy indexes
// are dropped and existing data is backfilled. Auto-building at require time
// would race the migration and could leave the app running without the
// double-booking guarantee.
mongoose.set("autoIndex", false);

// CORS — open for the Next.js frontend / public page by default. Set
// CORS_ORIGIN to a comma-separated allowlist to lock this down in production.
//
// FRONTEND_URL is accepted as a fallback because that is the name a deployed
// .env already used to express this intent. Reading only CORS_ORIGIN meant the
// allowlist an operator had carefully written was silently ignored and the API
// served every origin, so the variable name mattered more than the operator's
// intent. Both names now resolve to the same list.
const CORS_ORIGINS = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const corsOptions = CORS_ORIGINS.length
  ? { origin: CORS_ORIGINS, credentials: false }
  : {};
app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Baseline response hardening. The API serves customer PII, financial PDFs and
// operator-generated workbooks, so responses must never be sniffed as HTML or
// cached by an intermediary.
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  next();
});

// Uploads are user-supplied images served from the same origin. Never let a
// browser treat a stored file as something other than its declared type, and
// keep the API responses themselves uncacheable by shared caches.
// Invoices, audit workbooks and any other generated financial/PII documents are
// written to backend/exports/ and served ONLY through authenticated API routes.
// There is deliberately no static mount for them: a guessable URL must not
// expose customer names, phones or revenue.
app.use("/uploads", express.static(path.join(__dirname, "uploads"), { dotfiles: "deny" }));

// Authenticated JSON API — no-store so browsers never replay stale bodies.
// Without this, Express's default weak ETag turns repeat GET loads into 304
// revalidations that can serve stale or empty responses (observed on the
// invoices list after completing a booking).
app.disable("etag");
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Health check.
app.get("/api/health", (req, res) => res.json({ ok: true, service: "salon-spa-os-backend" }));

// API routes.
app.use("/api/auth", require("./routes/auth"));
app.use("/api/services", require("./routes/services"));
app.use("/api/staff", require("./routes/staff"));
app.use("/api/bookings", require("./routes/bookings"));
app.use("/api/packages", require("./routes/packages"));
app.use("/api/memberships", require("./routes/memberships"));
app.use("/api/products", require("./routes/products"));
app.use("/api/offers", require("./routes/offers"));
app.use("/api/invoices", require("./routes/invoices"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/whatsapp", require("./routes/whatsapp"));
app.use("/api/payment", require("./routes/payment"));
app.use("/api/calendar", require("./routes/calendar"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/leads", require("./routes/leads"));
app.use("/api/audit", require("./routes/audit"));

// 404.
app.use((req, res) => res.status(404).json({ msg: "Not found" }));

// Central error handler — never leak internals.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.status) return res.status(err.status).json({ msg: err.message });
  if (err && err.name === "ValidationError") {
    return res.status(400).json({ msg: err.message });
  }
  // Malformed ObjectId in a path/query/body → 400, not a 500 stack trace.
  if (err && err.name === "CastError") {
    return res.status(400).json({ msg: "Invalid identifier" });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ msg: "Duplicate key error" });
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ msg: "File too large (max 5 MB)" });
  }
  if (err && err.code === "LIMIT_FILE_COUNT") {
    return res.status(400).json({ msg: "Too many files uploaded" });
  }
  if (err && err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).json({ msg: "Unexpected file field or too many files" });
  }
  console.error("[error]", err);
  res.status(500).json({ msg: "Internal server error" });
});

const PORT = process.env.PORT || 5005;
// No inline default: a development fallback that survives into production would
// quietly point a live deployment at a database that is not there, and the
// resulting connection error reads like an outage rather than a misconfiguration.
// Validation lives in assertProductionConfig() below.
const MONGO_URI = process.env.MONGO_URI || "";
const PUBLIC_DNS = (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Some networks/machines run a local resolver (VPN / security software) that
 * answers ordinary host lookups but refuses SRV queries (ECONNREFUSED), which
 * breaks the `mongodb+srv://` scheme Atlas uses. We keep the connection
 * configurable and resilient:
 *  - `DNS_SERVERS` env (comma-separated) pins Node's resolver explicitly.
 *  - Otherwise, a failed connect with an SRV/DNS error retries once using
 *    public resolvers (8.8.8.8, 1.1.1.1) before giving up.
 * Normal deployments are unaffected — when system DNS works, nothing changes.
 */
function configureDns(serverList) {
  try {
    dns.setServers(serverList);
    return true;
  } catch {
    return false;
  }
}

// Development-only default, applied here rather than at the constant so it can
// never be reached on a NODE_ENV=production boot (assertProductionConfig runs
// first and exits).
const DEV_MONGO_URI = "mongodb://localhost:27017/salon_spa_os";

/**
 * Refuse to boot a production deployment that is quietly running on development
 * defaults. Each of these is a setting whose absence changes behaviour rather
 * than breaking a request, which is exactly why they need a hard stop:
 *
 *  - MONGO_URI      a missing value would otherwise fall back to localhost.
 *  - JWT_SECRET     a shared fallback would let anyone mint an owner token.
 *  - CORS_ORIGIN    an unset allowlist serves every origin to a multi-tenant API.
 *
 * The integration report below is a warning, not a stop: WhatsApp and Razorpay
 * are optional features of this product and a deployment may legitimately run
 * with UPI/cash settlement only.
 */
function assertProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = [];
  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
  if (!process.env.MONGO_URI) missing.push("MONGO_URI");
  if (!CORS_ORIGINS.length) missing.push("CORS_ORIGIN");
  if (missing.length) {
    console.error(
      "Failed to start backend: required in production but not set — " +
        missing.join(", ")
    );
    process.exit(1);
  }
}

/**
 * Log which external integrations will actually reach their provider and which
 * will run in local mock mode. Without this, a production deployment missing
 * WHATSAPP_TOKEN logs a cheerful "N reminders queued" and the operator has no
 * signal that nothing was ever delivered.
 */
function reportIntegrationMode() {
  const integrations = [
    {
      name: "WhatsApp (Meta Cloud API)",
      live: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID),
      hint: "messages are logged locally and NOT delivered",
    },
    {
      name: "Razorpay",
      live: Boolean(process.env.RAZORPAY_KEY && process.env.RAZORPAY_SECRET),
      hint: "checkout is unavailable; settle by UPI/cash",
    },
    {
      name: "eSSL attendance devices",
      live: Boolean(process.env.ATTENDANCE_API_KEY),
      hint: "device sync is disabled (owner-signed sync still works)",
    },
  ];
  const mocked = integrations.filter((i) => !i.live);
  if (!mocked.length) {
    console.log(`[config] integrations live: ${integrations.map((i) => i.name).join(", ")}`);
    return;
  }
  console.warn(
    `[config] ${mocked.length}/${integrations.length} integrations are NOT configured — ` +
      mocked.map((i) => `${i.name} (${i.hint})`).join("; ")
  );
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[config] the server will still start. This is intentional for optional " +
        "integrations, but no message/payment will reach the provider until configured."
    );
  }
}

async function start() {
  mongoose.set("strictQuery", true);
  const connOpts = { serverSelectionTimeoutMS: 20000 };
  if (process.env.MONGO_DB) connOpts.dbName = process.env.MONGO_DB;

  // Only reached outside production: assertProductionConfig() has already exited
  // a production boot that had no MONGO_URI.
  const mongoUri = MONGO_URI || DEV_MONGO_URI;
  if (!MONGO_URI) {
    console.warn(
      `[db] MONGO_URI is not set - falling back to the development default (${DEV_MONGO_URI})`
    );
  }

  if (process.env.DNS_SERVERS) {
    configureDns(PUBLIC_DNS);
    console.log(`[dns] using DNS_SERVERS: ${PUBLIC_DNS.join(", ")}`);
  }

  try {
    await mongoose.connect(mongoUri, connOpts);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const dnsSymptom = /querySrv|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(msg);
    if (!process.env.DNS_SERVERS && dnsSymptom && configureDns(PUBLIC_DNS)) {
      console.warn(
        "[db] system DNS failed to resolve MongoDB, retrying with public resolvers " +
          PUBLIC_DNS.join(", ")
      );
      await mongoose.connect(mongoUri, connOpts);
    } else {
      throw err;
    }
  }
  console.log(`[db] connected to MongoDB (${mongoose.connection.name})`);

  // Build indexes (and migrate legacy booking data) before accepting traffic,
  // so the double-booking / one-invoice-per-booking guarantees are enforced.
  const { initializeDatabase } = require("./db");
  await initializeDatabase();
  console.log("[db] indexes verified");

  // Start scheduled jobs once (safe-guarded inside cron.js).
  //
  // DISABLE_CRON parks the background timers without touching the HTTP surface.
  // It exists so a harness can drive the full API deterministically: the
  // no-show sweep, the offer-expiry pass and the order reaper all key off the
  // wall clock, so a test fixture that must stay `booked` can otherwise be
  // reclassified mid-run (which is exactly how the e2e suite's own "advance is
  // payable" assertions became time-of-day dependent). Their logic is still
  // covered, because those jobs are invoked directly.
  //
  // Refused in production. A deployment whose sweeps silently never run is a
  // correctness bug, not a convenience, so the setting is ignored there and
  // said out loud rather than honoured quietly.
  const cronRequested =
    !process.env.DISABLE_CRON || process.env.NODE_ENV === "production";
  if (process.env.DISABLE_CRON) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[cron] DISABLE_CRON is set but IGNORED: production must run scheduled jobs"
      );
    } else {
      console.log("[cron] DISABLE_CRON set - scheduled jobs NOT started");
    }
  }
  if (cronRequested) {
    require("./cron");
  }

  reportIntegrationMode();

  // No host argument, so Node binds :: (all interfaces). Say so, rather than
  // printing "localhost", which would tell an operator the API is reachable
  // only from the machine itself when it is in fact exposed on every
  // interface and reachable from outside.
  app.listen(PORT, () => {
    console.log(`[server] Salon & Spa OS backend listening on port ${PORT} (all interfaces)`);
    console.log(`[server] API base http://<this-host>:${PORT}/api`);
  });
}

// Refuse to boot a production deployment that is running on development
// defaults — see assertProductionConfig() for the full list and the reasoning.
if (require.main === module) {
  assertProductionConfig();
  if (!process.env.JWT_SECRET) {
    console.warn(
      "[security] JWT_SECRET is not set. Requests will be rejected until it is configured."
    );
  }
  if (!CORS_ORIGINS.length) {
    console.warn(
      "[security] CORS_ORIGIN is not set - every origin is accepted. Set it to a " +
        "comma-separated allowlist before exposing this API publicly."
    );
  }
  start().catch((err) => {
    console.error("Failed to start backend:", err.message);
    process.exit(1);
  });
}

module.exports = { app, start, assertProductionConfig, reportIntegrationMode };