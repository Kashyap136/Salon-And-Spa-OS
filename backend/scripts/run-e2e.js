/**
 * End-to-end test suite for the Salon & Spa OS backend.
 *
 * Boots an ephemeral MongoDB via mongodb-memory-server, spawns the real
 * server (node app.js) against it, and exercises the API over HTTP.
 *
 *   npm test        (or: node scripts/run-e2e.js)
 */
const { MongoMemoryServer } = require("mongodb-memory-server");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

const ROOT = path.join(__dirname, "..");
const PORT = 5155;
const BASE = `http://localhost:${PORT}/api`;
const RAW = `http://localhost:${PORT}`;

const RAZORPAY_SECRET = "rzp_test_dummy_secret_1234";

let server, child;
let passes = 0, failures = 0;
const results = [];

function check(name, cond, extra) {
  if (cond) {
    passes++;
    results.push(`PASS ${name}`);
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    results.push(`FAIL ${name} :: ${JSON.stringify(extra)}`);
    console.error(`  ✗ ${name} — ${JSON.stringify(extra)}`);
  }
  return cond;
}

async function expectStatus(promise, status) {
  try {
    const res = await promise;
    return { ok: res.status === status, status: res.status, data: res.data };
  } catch (err) {
    return {
      ok: err.response ? err.response.status === status : false,
      status: err.response ? err.response.status : null,
      data: err.response ? err.response.data : err.message,
    };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      await axios.get(url, { timeout: 2000 });
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

const headers = (token) => ({ Authorization: `Bearer ${token}` });

function today() {
  return new Date().toISOString().slice(0, 10);
}

(async () => {
  console.log("Starting e2e tests…");

  // 60s launch timeout — first run may download the MongoDB binary and
  // cold Windows startup can exceed the 10s default.
  server = await MongoMemoryServer.create({ launchTimeout: 60000 });
  const uri = server.getUri();
  console.log(`MongoDB (in-memory) ready`);

  child = spawn(process.execPath, ["app.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGO_URI: uri,
      JWT_SECRET: "test-secret-salon-spa-2026",
      RAZORPAY_SECRET,
      UPI_ID: "testsalon@upi",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`   [server] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`   [server] ${d}`));

  const up = await waitForServer(`${BASE}/health`);
  check("server booted / Mongo connected", up);

  let A = {}; // company A state
  let B = {}; // company B state
  let inv;

  // ---- Auth ---------------------------------------------------------------
  let r = await expectStatus(
    axios.post(`${BASE}/auth/register`, {
      name: "Test Salon",
      subdomain: "testsalon",
      ownerEmail: "owner@test.com",
      password: "secret123",
      salonType: "unisex",
      location: "Baner, Pune",
    }),
    201
  );
  check("register returns 201 + token", r.ok && r.data.token && r.data.companyId, r);
  A.companyId = r.data.companyId;
  A.token = r.data.token;

  r = await expectStatus(
    axios.post(`${BASE}/auth/login`, {
      subdomain: "testsalon",
      email: "owner@test.com",
      password: "secret123",
    }),
    200
  );
  check("login returns token + name", r.ok && r.data.token && r.data.name === "Test Salon", r);
  A.token = r.data.token;

  r = await expectStatus(
    axios.post(`${BASE}/auth/login`, { subdomain: "testsalon", email: "owner@test.com", password: "wrong" }),
    401
  );
  check("login rejects bad password (401)", r.ok, r);

  // Duplicate subdomain.
  r = await expectStatus(
    axios.post(`${BASE}/auth/register`, {
      name: "Dup", subdomain: "testsalon", ownerEmail: "x@y.com", password: "secret123",
    }),
    409
  );
  check("duplicate subdomain returns 409", r.ok, r);

  // ---- Services -----------------------------------------------------------
  const imgBuf = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fdService = new FormData();
  fdService.append("name", "Hair Cut");
  fdService.append("category", "hair");
  fdService.append("durationMins", "45");
  fdService.append("price", "1000");
  fdService.append("gender", "U");
  fdService.append("isCombo", "false");
  fdService.append("image", new File([imgBuf], "hair.png", { type: "image/png" }));

  r = await expectStatus(
    axios.post(`${BASE}/services/create`, fdService, { headers: { ...headers(A.token), "Content-Type": "multipart/form-data" } }),
    201
  );
  check("service created (multipart)", r.ok && r.data._id, r);
  A.service = r.data;
  check("service image path served", !!r.data.imageUrl && r.data.imageUrl.startsWith("/uploads/services/"), r.data && r.data.imageUrl);

  const imgRes = await axios.get(`${RAW}${A.service.imageUrl}`, { responseType: "arraybuffer" }).catch(() => null);
  check("uploaded image served statically", !!imgRes && imgRes.status === 200 && imgRes.data.length > 0, imgRes && imgRes.status);

  r = await expectStatus(
    axios.post(`${BASE}/services/create`, {
      name: "Spa Session", category: "spa", durationMins: 60, price: 1500, gender: "U",
    }, { headers: headers(A.token) }),
    201
  );
  check("second service created", r.ok, r);
  A.serviceSpa = r.data;

  // Category/gender filter.
  r = await expectStatus(
    axios.get(`${BASE}/services/list?companyId=${A.companyId}&category=spa`, { headers: headers(A.token) }),
    200
  );
  check("service list filters by category", r.ok && Array.isArray(r.data) && r.data.length === 1 && r.data[0].name === "Spa Session", r.data);

  // ---- Staff --------------------------------------------------------------
  const fdStaff = new FormData();
  const staffForm = {
    name: "Ramesh", phone: "9876500001", specialization: "hair", experienceYears: 5,
    salary: 30000, commissionPercent: 15, esslId: "ESSL101",
  };
  Object.entries(staffForm).forEach(([k, v]) => fdStaff.append(k, v));
  fdStaff.append("photo", new File([imgBuf], "staff.png", { type: "image/png" }));

  r = await expectStatus(
    axios.post(`${BASE}/staff/create`, fdStaff, { headers: { ...headers(A.token), "Content-Type": "multipart/form-data" } }),
    201
  );
  check("staff created (multipart)", r.ok && r.data._id && r.data.commissionPercent === 15, r);
  A.staff = r.data;

  // ---- Packages -----------------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/packages/create`, {
      name: "Spa Day",
      services: [{ serviceId: A.serviceSpa._id, qty: 2 }],
      price: 1800,
      originalPrice: 3000,
      validityDays: 30,
    }, { headers: headers(A.token) }),
    201
  );
  check("package created with savings", r.ok && r.data.savings === 1200 && r.data.services[0].qty === 2, r);
  A.package = r.data;

  // ---- Offers -------------------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "DIWALI20", title: "Diwali 20% off", discountType: "percent", discountValue: 20,
      minOrderAmount: 100, maxDiscount: 150, usageLimit: 10,
      validFrom: "2020-01-01", validUntil: "2099-12-31",
      applicableServices: [], applicablePackages: [],
    }, { headers: headers(A.token) }),
    201
  );
  check("percent offer created", r.ok && r.data.code === "DIWALI20", r);

  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "FLAT50", title: "Flat 50", discountType: "flat", discountValue: 50,
      minOrderAmount: 0, maxDiscount: 0, usageLimit: 0,
      validFrom: "2020-01-01", validUntil: "2099-12-31",
      applicableServices: [], applicablePackages: [],
    }, { headers: headers(A.token) }),
    201
  );
  check("flat offer created", r.ok && r.data.discountType === "flat", r);

  // Offer validate — cap at maxDiscount (20% of 1000 = 200 → capped to 150).
  r = await expectStatus(
    axios.post(`${BASE}/offers/validate`, { code: "DIWALI20", serviceId: A.service._id, total: 1000 }, { headers: headers(A.token) }),
    200
  );
  check("offer validate caps discount", r.ok && r.data.valid === true && r.data.discount === 150 && r.data.offerId, r);

  r = await expectStatus(
    axios.get(`${BASE}/offers/list?companyId=${A.companyId}&isActive=true`, { headers: headers(A.token) }),
    200
  );
  check("offer list isActive filter", r.ok && r.data.length === 2, r.data.length);

  // ---- Products -----------------------------------------------------------
  const fdProduct = new FormData();
  Object.entries({ name: "Shampoo", brand: "Loreal", price: "200", gstPercent: "18", stock: "10", minStock: "5" })
    .forEach(([k, v]) => fdProduct.append(k, v));
  fdProduct.append("images", new File([imgBuf], "p1.png", { type: "image/png" }));
  fdProduct.append("images", new File([imgBuf], "p2.png", { type: "image/png" }));

  r = await expectStatus(
    axios.post(`${BASE}/products/create`, fdProduct, { headers: { ...headers(A.token), "Content-Type": "multipart/form-data" } }),
    201
  );
  check("product created with 2 images", r.ok && r.data.images.length === 2, r);
  A.product = r.data;

  r = await expectStatus(
    axios.post(`${BASE}/products/create`, {
      name: "Hair Oil", brand: "Parachute", price: 100, gstPercent: 18, stock: 2, minStock: 5,
    }, { headers: headers(A.token) }),
    201
  );
  check("low-stock product created", r.ok, r);
  A.productLow = r.data;

  r = await expectStatus(
    axios.get(`${BASE}/products/list?companyId=${A.companyId}&lowStock=true`, { headers: headers(A.token) }),
    200
  );
  check("low-stock filter (stock <= minStock)", r.ok && r.data.length === 1 && r.data[0].name === "Hair Oil", r.data);

  // ---- Bookings -----------------------------------------------------------
  const bookingPayload = {
    customerName: "Priya", phone: "9970001234", email: "priya@test.com",
    serviceId: A.service._id, staffId: A.staff._id,
    bookingDate: today(), slot: "11:00-11:30", paymentMode: "UPI",
    offerCode: "DIWALI20",
  };

  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, bookingPayload, { headers: headers(A.token) }),
    201
  );
  check(
    "booking created — 20% advance, discount, capped total",
    r.ok &&
      r.data.advancePaid === 170 && // (1000 - 150) * 0.2
      r.data.discountApplied === 150 &&
      r.data.total === 850 &&
      r.data.advancePercent === 20,
    r.data
  );
  A.booking = r.data;

  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, bookingPayload, { headers: headers(A.token) }),
    409
  );
  check("double-booking returns 409", r.ok && /Slot already booked/.test(r.data.msg), r);

  // Offer usage incremented.
  r = await expectStatus(
    axios.get(`${BASE}/offers/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const diwali = (r.data || []).find((o) => o.code === "DIWALI20");
  check("offer usedCount incremented", r.ok && diwali && diwali.usedCount === 1, diwali);

  // Booking list + stats.
  r = await expectStatus(
    axios.get(`${BASE}/bookings/list?companyId=${A.companyId}&date=${today()}`, { headers: headers(A.token) }),
    200
  );
  check("bookings list populates service + staff", r.ok && r.data.length === 1 && r.data[0].serviceId.name === "Hair Cut" && r.data[0].staffId.name === "Ramesh", r.data);

  r = await expectStatus(
    axios.get(`${BASE}/bookings/stats?companyId=${A.companyId}&date=${today()}`, { headers: headers(A.token) }),
    200
  );
  check("booking stats (0 completed)", r.ok && r.data.total === 1 && r.data.completed === 0 && r.data.noShowPercent === 0, r.data);

  // No-show booking (different slot).
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "12:00-12:30", customerName: "Amit" }, { headers: headers(A.token) }),
    201
  );
  A.bookingNoShow = r.data;
  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: A.bookingNoShow._id, status: "no-show" }, { headers: headers(A.token) }),
    200
  );
  check("no-show status set (advance kept)", r.ok && r.data.msg && /retained/.test(r.data.msg), r.data);

  r = await expectStatus(
    axios.get(`${BASE}/bookings/stats?companyId=${A.companyId}&date=${today()}`, { headers: headers(A.token) }),
    200
  );
  check("stats no-show % = 50 (1 no-show of 2)", r.ok && r.data.noshow === 1 && r.data.noShowPercent === 50, r.data);

  // Cancel + rebook same slot (cancelled must release the slot).
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "13:00-13:30", customerName: "Cancel Test" }, { headers: headers(A.token) }),
    201
  );
  const toCancel = r.data._id;
  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: toCancel, status: "cancelled" }, { headers: headers(A.token) }),
    200
  );
  check("booking cancelled", r.ok, r.data);
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "13:00-13:30", customerName: "Rebooked" }, { headers: headers(A.token) }),
    201
  );
  check("cancelled booking released the slot", r.ok && r.data.slot === "13:00-13:30", r.data);

  // ---- Complete booking → invoice -----------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, {
      bookingId: A.booking._id,
      status: "completed",
      productsUsed: [{ productId: A.product._id, qty: 2 }],
    }, { headers: headers(A.token) }),
    200
  );
  check("booking completion returns invoiceId", r.ok && r.data.invoiceId, r);

  r = await expectStatus(
    axios.get(`${BASE}/products/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const shampoo = (r.data || []).find((p) => p._id === A.product._id);
  check("product stock deducted (10→8)", r.ok && shampoo && shampoo.stock === 8, shampoo);

  r = await expectStatus(
    axios.get(`${BASE}/invoices/list?companyId=${A.companyId}&date=${today()}`, { headers: headers(A.token) }),
    200
  );
  check("invoice list returns generated invoice", r.ok && r.data.length === 1, r.data);
  inv = r.data[0];
  check(
    "invoice math — total/gst/grand/commission",
    inv.total === 1400 &&      // 1000 service + 400 products
      inv.gstTotal === 252 &&  // 18% of 1400
      inv.discount === 150 &&  // offer discount
      inv.grandTotal === 1502 && // total + gst − discount
      inv.staffCommission === 150, // 15% of 1000
    inv
  );
  check("invoice number format INV-YYYY-XXXXXX", /^INV-\d{4}-\d{6}$/.test(inv.invoiceNo), inv.invoiceNo);

  // Invoice PDF.
  r = await expectStatus(
    axios.get(`${BASE}/invoices/pdf/${inv._id}?companyId=${A.companyId}`, { headers: headers(A.token), responseType: "arraybuffer", validateStatus: () => true }),
    200
  );
  check("invoice PDF generated", r.ok && r.status === 200, r);

  // Mark paid.
  r = await expectStatus(
    axios.post(`${BASE}/invoices/pay`, { invoiceId: inv._id }, { headers: headers(A.token) }),
    200
  );
  check("invoice marked paid", r.ok && r.data.invoice.paymentStatus === "paid", r.data);

  // ---- Payment verification ------------------------------------------------
  const payRef = { razorpay_payment_id: "pay_test_1", razorpay_order_id: "order_test_1" };
  const goodSig = crypto
    .createHmac("sha256", RAZORPAY_SECRET)
    .update(`${payRef.razorpay_order_id}|${payRef.razorpay_payment_id}`)
    .digest("hex");
  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, {
      ...payRef, razorpay_signature: goodSig, bookingId: A.booking._id, invoiceId: inv._id,
    }),
    200
  );
  check("payment signature verified (booking+invoice paid)", r.ok && r.data.msg === "Payment verified", r);

  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, {
      ...payRef, razorpay_signature: "deadbeef", bookingId: A.booking._id,
    }),
    400
  );
  check("payment signature mismatch → 400", r.ok, r);

  // ---- WhatsApp (mock mode — no credentials) ------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/whatsapp/send`, { bookingId: A.booking._id, type: "confirmation", language: "Marathi" }, { headers: headers(A.token) }),
    200
  );
  check("whatsapp confirmation (mock) returns text", r.ok && r.data.message && r.data.mocked === true, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/whatsapp/test`, { type: "invoice", language: "Hindi" }, { headers: headers(A.token) }),
    200
  );
  check("whatsapp test endpoint returns msg", r.ok && typeof r.data.msg === "string" && r.data.msg.length > 0, r.data);

  // ---- Salon settings (GET/PUT) ----------------------------------------------
  r = await expectStatus(
    axios.put(`${BASE}/auth/settings`, {
      language: "Hindi", upiId: "salon@okhdfc", location: "MG Road, Pune", gstNo: "GSTIN123",
    }, { headers: headers(A.token) }),
    200
  );
  check("settings updated (language/upi/location)", r.ok && r.data.company && r.data.company.language === "Hindi", r.data);

  r = await expectStatus(
    axios.get(`${BASE}/auth/settings`, { headers: headers(A.token) }),
    200
  );
  const s = r.data || {};
  check(
    "settings GET returns safe subset (no token leak)",
    r.ok && s.upiId === "salon@okhdfc" && s.language === "Hindi" &&
      !("passwordHash" in s) && s.whatsappToken === undefined && typeof s.whatsappConfigured === "boolean",
    s
  );

  r = await expectStatus(
    axios.get(`${BASE}/auth/settings`),
    401
  );
  check("settings GET requires auth", r.ok, r);

  // ---- Memberships ---------------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/memberships/create`, {
      customerName: "Sneha", phone: "9960005555", packageId: A.package._id, startDate: today(),
    }, { headers: headers(A.token) }),
    201
  );
  check("membership created (servicesTotal=2)", r.ok && r.data.servicesTotal === 2 && r.data.status === "active", r.data);
  A.membership = r.data;

  r = await expectStatus(
    axios.post(`${BASE}/memberships/use`, { membershipId: A.membership._id, serviceId: A.serviceSpa._id }, { headers: headers(A.token) }),
    200
  );
  check("membership use #1", r.ok && r.data.servicesUsed.length === 1, r.data);
  r = await expectStatus(
    axios.post(`${BASE}/memberships/use`, { membershipId: A.membership._id, serviceId: A.serviceSpa._id }, { headers: headers(A.token) }),
    200
  );
  check("membership use #2 → expired (all used)", r.ok && r.data.status === "expired" && r.data.servicesUsed.length === 2, r.data);
  r = await expectStatus(
    axios.post(`${BASE}/memberships/use`, { membershipId: A.membership._id, serviceId: A.serviceSpa._id }, { headers: headers(A.token) }),
    400
  );
  check("membership use after expiry → 400", r.ok, r.data);

  r = await expectStatus(
    axios.get(`${BASE}/memberships/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const mems = r.data || [];
  check(
    "memberships list nested-populates package services (names for dropdown)",
    r.ok && mems.length === 1 && Array.isArray(mems[0].packageId.services) &&
      typeof mems[0].packageId.services[0].serviceId?.name === "string",
    mems[0] && mems[0].packageId && mems[0].packageId.services
  );

  // ---- Calendar ------------------------------------------------------------
  r = await expectStatus(
    axios.get(`${BASE}/bookings/calendar?companyId=${A.companyId}&month=${today().slice(0, 7)}`, { headers: headers(A.token) }),
    200
  );
  check("bookings/calendar groups by date", r.ok && r.data.byDate[today()] && r.data.total > 0, r.data && r.data.total);

  r = await expectStatus(
    axios.get(`${BASE}/calendar?companyId=${A.companyId}&month=${today().slice(0, 7)}`, { headers: headers(A.token) }),
    200
  );
  check("/api/calendar alias works", r.ok && r.data.total > 0, r.data && r.data.total);

  // ---- Public endpoints ----------------------------------------------------
  r = await expectStatus(axios.get(`${BASE}/services/public?subdomain=testsalon`), 200);
  check("public services", r.ok && r.data.company._id === A.companyId && r.data.services.length >= 2, r.data && r.data.services.length);

  r = await expectStatus(axios.get(`${BASE}/packages/public?subdomain=testsalon`), 200);
  check("public packages", r.ok && r.data.company._id === A.companyId && r.data.packages.length === 1, r.data.packages && r.data.packages.length);

  r = await expectStatus(axios.get(`${BASE}/services/public?subdomain=nope`), 404);
  check("public services — unknown salon 404", r.ok, r);

  // Public booking + double-book protection.
  const pubPayload = {
    companyId: A.companyId, customerName: "Public Guest", phone: "9990001111",
    serviceId: A.service._id, staffId: A.staff._id,
    bookingDate: "2099-01-05", slot: "14:00-14:30", paymentMode: "UPI",
  };
  r = await expectStatus(axios.post(`${BASE}/bookings/public/create`, pubPayload), 201);
  check("public booking created (no auth)", r.ok && r.data.advancePaid === 200 && r.data.total === 1000, r.data);
  r = await expectStatus(axios.post(`${BASE}/bookings/public/create`, pubPayload), 409);
  check("public booking double-slot → 409", r.ok, r);

  // ---- Reviews / Leads -----------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/reviews/create`, { bookingId: A.booking._id, rating: 5, comment: "Great service" }),
    201
  );
  check("review created (public, no auth)", r.ok && r.data.customerName === "Priya", r.data);
  r = await expectStatus(
    axios.post(`${BASE}/reviews/create`, { bookingId: A.booking._id, rating: 6 }),
    400
  );
  check("review rating > 5 rejected", r.ok, r);

  r = await expectStatus(axios.get(`${BASE}/reviews/list?companyId=${A.companyId}`), 200);
  check("reviews list + average", r.ok && r.data.reviews.length === 1 && r.data.average === 5, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/leads/create`, { companyId: A.companyId, name: "Walk-in", phone: "9112223333", message: "Opening hours?", source: "public" }),
    201
  );
  check("lead created (public)", r.ok && r.data.status === "new", r.data);
  r = await expectStatus(
    axios.get(`${BASE}/leads/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  check("leads list (auth)", r.ok && r.data.length === 1, r.data.length);

  // ---- Attendance (eSSL) ----------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:00", outTime: "18:30", date: today() }),
    200
  );
  check("attendance sync by esslId", r.ok && r.data.attendance && String(r.data.attendance.staffId) === A.staff._id, r.data);
  r = await expectStatus(
    axios.get(`${BASE}/attendance/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  check("attendance list (auth)", r.ok && r.data.length === 1, r.data.length);

  // Multi-tenant: same eSSL id in two salons must not cross-write.
  r = await expectStatus(
    axios.post(`${BASE}/auth/register`, {
      name: "Salon C", subdomain: "salonc", ownerEmail: "c@test.com", password: "secret123",
    }),
    201
  );
  const C = { token: r.data.token, companyId: r.data.companyId };
  r = await expectStatus(
    axios.post(`${BASE}/staff/create`, { name: "Ravi", phone: "9100000000", esslId: "ESSL101", companyId: C.companyId }, { headers: headers(C.token) }),
    201
  );
  check("company C staff created (same essl id)", r.ok, r.data);
  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:30", outTime: "17:30", date: today() }),
    400
  );
  check("ambiguous eSSL id without companyId → 400", r.ok, r.data);
  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:30", outTime: "17:30", date: today(), companyId: C.companyId }),
    200
  );
  check(
    "sync scoped by companyId (no cross-salon records)",
    r.ok && r.data.attendance && String(r.data.attendance.companyId) === C.companyId &&
      String(r.data.attendance.staffId) !== A.staff._id,
    r.data
  );

  // ---- Audit export ----------------------------------------------------------
  r = await expectStatus(
    axios.get(`${BASE}/audit/export?companyId=${A.companyId}&year=${new Date().getFullYear()}`, { headers: headers(A.token) }),
    200
  );
  check("audit export returns fileUrl + count", r.ok && r.data.fileUrl && r.data.count >= 1, r.data);
  const xlsx = await axios.get(`${RAW}${r.data.fileUrl}`, { responseType: "arraybuffer" }).catch(() => null);
  check("audit xlsx served", !!xlsx && xlsx.status === 200 && xlsx.data.length > 1000, xlsx && xlsx.data.length);

  // ---- Multi-tenant isolation ------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/auth/register`, {
      name: "Other Salon", subdomain: "other", ownerEmail: "other@test.com", password: "secret123", salonType: "women",
    }),
    201
  );
  check("company B registered", r.ok, r);
  B.token = r.data.token;
  B.companyId = r.data.companyId;

  r = await expectStatus(
    axios.get(`${BASE}/services/list?companyId=${A.companyId}`, { headers: headers(B.token) }),
    200
  );
  check("isolation: B cannot see A's services", r.ok && Array.isArray(r.data) && r.data.length === 0, r.data.length);

  r = await expectStatus(
    axios.post(`${BASE}/invoices/pay`, { invoiceId: inv._id }, { headers: headers(B.token) }),
    404
  );
  check("isolation: B cannot pay A's invoice (404)", r.ok, r);

  r = await expectStatus(
    axios.get(`${BASE}/services/list?companyId=${B.companyId}`, { headers: headers(A.token) }),
    200
  );
  check("isolation: A token ignores foreign companyId query", r.ok && r.data.length === 2, r.data.length);

  r = await expectStatus(
    axios.get(`${BASE}/bookings/list?companyId=${A.companyId}&date=${today()}`, { headers: headers(B.token) }),
    200
  );
  check("isolation: B cannot see A's bookings", r.ok && r.data.length === 0, r.data.length);

  // ---- Validation / edge cases ------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "99:00-99:30" }, { headers: headers(A.token) }),
    400
  );
  check("invalid slot rejected (400)", r.ok, r);

  r = await expectStatus(
    axios.get(`${BASE}/bookings/stats?companyId=${B.companyId}&date=${today()}`, { headers: headers(B.token) }),
    200
  );
  check("stats handles zero bookings", r.ok && r.data.total === 0 && r.data.noShowPercent === 0, r.data);

  // ---- Teardown ---------------------------------------------------------------
  console.log(`\n===== RESULTS: ${passes} passed, ${failures} failed =====`);
  child.kill();
  await server.stop();
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error("E2E suite crashed:", err);
  if (child) child.kill();
  if (server) await server.stop();
  process.exit(1);
});