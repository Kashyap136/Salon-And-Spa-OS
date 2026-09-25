require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dns = require("dns");
const path = require("path");

const app = express();

// CORS — open for the Next.js frontend / public page.
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Static files: uploads and exports.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/public", express.static(path.join(__dirname, "public")));

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
  if (err && err.code === 11000) {
    return res.status(409).json({ msg: "Duplicate key error" });
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ msg: "File too large (max 5 MB)" });
  }
  console.error("[error]", err);
  res.status(500).json({ msg: "Internal server error" });
});

const PORT = process.env.PORT || 5005;
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/salon_spa_os";
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

async function start() {
  mongoose.set("strictQuery", true);
  const connOpts = { serverSelectionTimeoutMS: 20000 };
  if (process.env.MONGO_DB) connOpts.dbName = process.env.MONGO_DB;

  if (process.env.DNS_SERVERS) {
    configureDns(PUBLIC_DNS);
    console.log(`[dns] using DNS_SERVERS: ${PUBLIC_DNS.join(", ")}`);
  }

  try {
    await mongoose.connect(MONGO_URI, connOpts);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const dnsSymptom = /querySrv|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(msg);
    if (!process.env.DNS_SERVERS && dnsSymptom && configureDns(PUBLIC_DNS)) {
      console.warn(
        "[db] system DNS failed to resolve MongoDB, retrying with public resolvers " +
          PUBLIC_DNS.join(", ")
      );
      await mongoose.connect(MONGO_URI, connOpts);
    } else {
      throw err;
    }
  }
  console.log(`[db] connected to MongoDB (${mongoose.connection.name})`);

  // Start scheduled jobs once (safe-guarded inside cron.js).
  require("./cron");

  app.listen(PORT, () => {
    console.log(`[server] Salon & Spa OS backend listening on http://localhost:${PORT}`);
    console.log(`[server] API base http://localhost:${PORT}/api`);
  });
}

if (!process.env.JWT_SECRET) {
  console.warn(
    "[security] JWT_SECRET is not set — using an insecure development fallback. Set JWT_SECRET in the environment before deploying."
  );
}

if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start backend:", err.message);
    process.exit(1);
  });
}

module.exports = { app, start };