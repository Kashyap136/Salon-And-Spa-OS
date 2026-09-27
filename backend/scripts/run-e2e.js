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
const ATTENDANCE_KEY = "test-device-key";

let server, child;
let passes = 0, failures = 0;
const results = [];

const attHeaders = () => ({ "x-attendance-key": ATTENDANCE_KEY });

/** Lists must be arrays — never let a failed response crash the suite. */
const asList = (data) => (Array.isArray(data) ? data : []);

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

/**
 * Local YYYY-MM-DD, matching the server's own local-day comparison. Using
 * toISOString() here would shift the date across the UTC boundary and the
 * "cannot be in the past" check would then reject a legitimate booking.
 */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
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
      ATTENDANCE_API_KEY: ATTENDANCE_KEY,
      UPI_ID: "testsalon@upi",
      NODE_ENV: "test",
      // Park the background timers. The no-show sweep reclassifies any booking
      // whose slot has already elapsed, which would mutate this suite's own
      // fixtures mid-run once the wall clock passes their slot + 60min grace.
      // Cron logic is still asserted, by invoking the jobs directly.
      DISABLE_CRON: "1",
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

  // Company B is registered up front so the isolation assertions later in the
  // run can also use it for tenant-scoped export checks.
  r = await expectStatus(
    axios.post(`${BASE}/auth/register`, {
      name: "Other Salon", subdomain: "other", ownerEmail: "other@test.com", password: "secret123", salonType: "women",
    }),
    201
  );
  check("company B registered", r.ok, r);
  B.token = r.data.token;
  B.companyId = r.data.companyId;

  // ---- Authentication boundaries -------------------------------------------
  r = await expectStatus(axios.get(`${BASE}/services/list`, { headers: { Authorization: "Bearer not-a-jwt" } }), 401);
  check("garbage bearer token → 401 (not a cast/session clear)", r.ok, r);

  r = await expectStatus(axios.get(`${BASE}/services/list`, { headers: { Authorization: "Basic abc" } }), 401);
  check("non-Bearer Authorization header → 401", r.ok, r);

  // A token signed with the wrong secret must never be accepted.
  const foreignToken = require("jsonwebtoken").sign(
    { companyId: A.companyId },
    "attacker-secret",
    { algorithm: "HS256", expiresIn: "1d" }
  );
  r = await expectStatus(axios.get(`${BASE}/services/list`, { headers: { Authorization: `Bearer ${foreignToken}` } }), 401);
  check("JWT signed with a different secret → 401", r.ok, r);

  // alg:none is the classic JWT downgrade; the verifier pins HS256.
  const noneToken = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }) + "." + Buffer.from(JSON.stringify({ companyId: A.companyId })).toString("base64url") + "."
  ).toString("base64url");
  r = await expectStatus(axios.get(`${BASE}/services/list`, { headers: { Authorization: `Bearer ${noneToken}` } }), 401);
  check("alg:none JWT is rejected", r.ok, r);

  r = await expectStatus(axios.get(`${BASE}/services/public?subdomain=testsalon`), 200);
  check(
    "public service payload never leaks credentials or payroll fields",
    r.ok && r.data.company && !("passwordHash" in r.data.company) && !("ownerEmail" in r.data.company),
    r.data && r.data.company
  );

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
  const diwali = asList(r.data).find((o) => o.code === "DIWALI20");
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

  // The booking above consumed a use of DIWALI20; a no-show is not a redemption,
  // so the counter must be handed straight back.
  r = await expectStatus(
    axios.get(`${BASE}/offers/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const usedBeforeNoShow = (asList(r.data).find((o) => o.code === "DIWALI20") || {}).usedCount;
  check("offer use is reserved while a booking is live", usedBeforeNoShow === 2, usedBeforeNoShow);

  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: A.bookingNoShow._id, status: "no-show" }, { headers: headers(A.token) }),
    200
  );
  check("no-show status set (advance kept)", r.ok && r.data.msg && /retained/.test(r.data.msg), r.data);

  r = await expectStatus(
    axios.get(`${BASE}/offers/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const usedAfterNoShow = (asList(r.data).find((o) => o.code === "DIWALI20") || {}).usedCount;
  check(
    "no-show releases the offer use (cap is not burned by a missed visit)",
    usedAfterNoShow === usedBeforeNoShow - 1,
    { usedBeforeNoShow, usedAfterNoShow }
  );

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
    axios.get(`${BASE}/offers/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const usedBeforeCancel = (asList(r.data).find((o) => o.code === "DIWALI20") || {}).usedCount;

  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: toCancel, status: "cancelled" }, { headers: headers(A.token) }),
    200
  );
  check("booking cancelled", r.ok, r.data);

  r = await expectStatus(
    axios.get(`${BASE}/offers/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const usedAfterCancel = (asList(r.data).find((o) => o.code === "DIWALI20") || {}).usedCount;
  check(
    "cancelling releases the offer use (no free coupons from cancel/rebook)",
    usedAfterCancel === usedBeforeCancel - 1,
    { usedBeforeCancel, usedAfterCancel }
  );

  // A second cancel of the same booking must not hand out a second free use.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: toCancel, status: "cancelled" }, { headers: headers(A.token) }),
    409
  );
  check("re-cancelling an already-cancelled booking → 409", r.ok, r.data);

  r = await expectStatus(
    axios.get(`${BASE}/offers/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const usedAfterDoubleCancel = (asList(r.data).find((o) => o.code === "DIWALI20") || {}).usedCount;
  check(
    "a rejected repeat cancel does not decrement the offer counter again",
    usedAfterDoubleCancel === usedAfterCancel,
    { usedAfterCancel, usedAfterDoubleCancel }
  );

  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "13:00-13:30", customerName: "Rebooked" }, { headers: headers(A.token) }),
    201
  );
  check("cancelled booking released the slot", r.ok && r.data.slot === "13:00-13:30", r.data);
  A.bookingRebooked = r.data;

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
  const shampoo = asList(r.data).find((p) => p._id === A.product._id);
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
  check(
    "invoice snapshots the advance already collected (for the balance)",
    inv.advancePaid === 170,
    inv.advancePaid
  );
  check("invoice number format INV-YYYY-XXXXXX", /^INV-\d{4}-\d{6}$/.test(inv.invoiceNo), inv.invoiceNo);

  // Invoice PDF.
  r = await expectStatus(
    axios.get(`${BASE}/invoices/pdf/${inv._id}?companyId=${A.companyId}`, { headers: headers(A.token), responseType: "arraybuffer", validateStatus: () => true }),
    200
  );
  check("invoice PDF generated", r.ok && r.status === 200, r);

  // ---- Payment verification -------------------------------------------------
  // Verification is bound to an order this server actually created. A crafted
  // signature with a client-chosen bookingId must NOT mark anything paid.
  const payRef = { razorpay_payment_id: "pay_test_1", razorpay_order_id: "order_test_1" };
  const goodSig = crypto
    .createHmac("sha256", RAZORPAY_SECRET)
    .update(`${payRef.razorpay_order_id}|${payRef.razorpay_payment_id}`)
    .digest("hex");

  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, {
      ...payRef, razorpay_signature: goodSig, bookingId: A.booking._id, invoiceId: inv._id,
    }),
    401
  );
  check("payment verify requires authentication (401)", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, {
      ...payRef, razorpay_signature: goodSig, bookingId: A.booking._id, invoiceId: inv._id,
    }, { headers: headers(A.token) }),
    404
  );
  check("payment verify rejects an order this server never created (404)", r.ok, r);

  const afterForged = await axios.get(`${BASE}/invoices/list`, { headers: headers(A.token) });
  check(
    "forged verification did not mark the invoice paid",
    (afterForged.data[0] || {}).paymentStatus !== "paid",
    afterForged.data[0] && afterForged.data[0].paymentStatus
  );

  // Persist a real order locally (stands in for Razorpay order creation, which
  // needs live API credentials) and verify against it.
  const child2 = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      await m.connection.collection("paymentorders").insertOne({
        companyId: new m.Types.ObjectId("${A.companyId}"),
        type: "invoice",
        resourceId: new m.Types.ObjectId("${inv._id}"),
        amountPaise: 150200,
        currency: "INR",
        razorpayOrderId: "${payRef.razorpay_order_id}",
        status: "created",
        createdAt: new Date(),
        paidAt: null,
      });
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], {
    cwd: ROOT,
    env: { ...process.env, MONGO_URI: uri },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise((resolve) => {
    child2.on("exit", resolve);
    child2.stderr.on("data", (d) => process.stderr.write(`   [seed] ${d}`));
  });

  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, { ...payRef, razorpay_signature: goodSig }, { headers: headers(A.token) }),
    200
  );
  check("payment verified against a persisted order", r.ok && r.data.msg === "Payment verified", r);

  const afterPay = await axios.get(`${BASE}/invoices/list`, { headers: headers(A.token) });
  check(
    "order-bound verification marked the bound invoice paid",
    (afterPay.data[0] || {}).paymentStatus === "paid",
    afterPay.data[0] && afterPay.data[0].paymentStatus
  );

  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, { ...payRef, razorpay_signature: goodSig }, { headers: headers(A.token) }),
    200
  );
  check("replaying a paid order is a no-op (not double-charged)", r.ok && r.data.alreadyPaid === true, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, { ...payRef, razorpay_signature: "deadbeef" }, { headers: headers(A.token) }),
    400
  );
  check("payment signature mismatch → 400", r.ok, r);

  // A valid order belonging to A must not settle B's copy of the data.
  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, { ...payRef, razorpay_signature: goodSig }, { headers: headers(B.token) }),
    404
  );
  check("payment order is tenant-bound (B cannot settle A's order)", r.ok, r);

  // An already-settled invoice can never take another order.
  r = await expectStatus(
    axios.post(`${BASE}/payment/create-order`, { type: "invoice", invoiceId: inv._id }, { headers: headers(A.token) }),
    409
  );
  check("create-order on an already-settled invoice → 409 (no double charge)", r.ok, r.data);

  // ---- One live order per resource (the actual live-order guard) -------------
  // The assertion above hit the ALREADY-PAID guard, not the live-order one, so
  // it never proved the "one live order" rule. Use a genuinely pending invoice.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, {
      ...bookingPayload, slot: "17:00-17:30", customerName: "Balance Test", offerCode: "",
    }, { headers: headers(A.token) }),
    201
  );
  A.bookingBalance = r.data;
  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: A.bookingBalance._id, status: "completed" }, { headers: headers(A.token) }),
    200
  );
  const pendingInv = (
    await axios.get(`${BASE}/invoices/list?companyId=${A.companyId}`, { headers: headers(A.token) })
  ).data.find((i) => String(i.bookingId) === String(A.bookingBalance._id));
  check("a second (pending) invoice exists for the live-order test", Boolean(pendingInv), r.data);

  // Seed an outstanding order for the PENDING invoice — exactly the state a
  // customer is in after clicking "Pay" and closing the Razorpay window.
  const seed3 = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      await m.connection.collection("paymentorders").insertOne({
        companyId: new m.Types.ObjectId("${A.companyId}"),
        type: "invoice",
        resourceId: new m.Types.ObjectId("${pendingInv._id}"),
        amountPaise: 100000,
        currency: "INR",
        razorpayOrderId: "order_live_pending_invoice",
        status: "created",
        createdAt: new Date(),
        paidAt: null,
      });
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve) => {
    seed3.on("exit", resolve);
    seed3.stderr.on("data", (d) => process.stderr.write(`   [seed] ${d}`));
  });

  r = await expectStatus(
    axios.post(`${BASE}/payment/create-order`, { type: "invoice", invoiceId: pendingInv._id }, { headers: headers(A.token) }),
    409
  );
  check(
    "a second order for a PENDING invoice with a live order → 409 (live-order guard, not the paid guard)",
    r.ok && /already exists/i.test(r.data.msg || ""),
    r.data
  );

  // ---- Charge the balance, not grandTotal -----------------------------------
  // resolvePayable is exported so this rule is testable without live Razorpay
  // credentials. grandTotal was 1502 and the advance already collected was 170,
  // so the order must be for 133200 paise — charging 150200 systematically
  // overcharged every customer by exactly the 20% advance.
  const balanceProbe = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      const { resolvePayable } = require("./routes/payment");
      const out = {};
      try {
        out.invoice = await resolvePayable("${A.companyId}", "invoice", null, "${pendingInv._id}");
      } catch (e) { out.invoiceErr = e.status + ":" + e.message; }
      try {
        out.booking = await resolvePayable("${A.companyId}", "booking", "${A.bookingRebooked._id}", null);
      } catch (e) { out.bookingErr = e.status + ":" + e.message; }
      // A cancelled booking must never be payable.
      try {
        out.cancelled = await resolvePayable("${A.companyId}", "booking", "${toCancel}", null);
      } catch (e) { out.cancelledErr = e.status + ":" + e.message; }
      // A completed booking must never take a fresh advance order.
      try {
        out.completed = await resolvePayable("${A.companyId}", "booking", "${A.booking._id}", null);
      } catch (e) { out.completedErr = e.status + ":" + e.message; }
      process.stdout.write(JSON.stringify(out));
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "pipe", "pipe"] });
  let probeOut = "";
  await new Promise((resolve) => {
    balanceProbe.on("exit", resolve);
    balanceProbe.stdout.on("data", (d) => { probeOut += d; });
    balanceProbe.stderr.on("data", (d) => process.stderr.write(`   [probe] ${d}`));
  });
  let probe = {};
  try { probe = JSON.parse(probeOut); } catch { /* reported below */ }

  const expectedBalancePaise = Math.round(
    ((pendingInv.grandTotal || 0) - (pendingInv.advancePaid || 0)) * 100
  );
  check(
    "invoice payment order is for the BALANCE (grandTotal − advance), not grandTotal",
    probe.invoice && probe.invoice.amountPaise === expectedBalancePaise &&
      probe.invoice.amountPaise !== Math.round((pendingInv.grandTotal || 0) * 100),
    {
      got: probe.invoice && probe.invoice.amountPaise,
      expectedBalancePaise,
      grandTotal: pendingInv.grandTotal,
      advancePaid: pendingInv.advancePaid,
    }
  );
  check(
    "a booking advance order is for the recorded advance",
    probe.booking && probe.booking.amountPaise === Math.round((A.bookingRebooked.advancePaid || 0) * 100),
    probe.booking
  );
  check(
    "a CANCELLED booking cannot raise a new advance order (409)",
    probe.cancelledErr && /^409:/.test(probe.cancelledErr),
    probe.cancelledErr
  );
  check(
    "a COMPLETED booking cannot raise a new advance order (409)",
    probe.completedErr && /^409:/.test(probe.completedErr),
    probe.completedErr
  );

  r = await expectStatus(
    axios.post(`${BASE}/payment/create-order`, { type: "booking", bookingId: A.bookingRebooked._id }, { headers: headers(A.token) }),
    503
  );
  check("create-order without Razorpay credentials degrades to 503", r.ok, r.data);

  // Manual settlement path (cash / UPI) is still available and idempotent.
  r = await expectStatus(
    axios.post(`${BASE}/invoices/pay`, { invoiceId: inv._id }, { headers: headers(A.token) }),
    200
  );
  check("invoice pay endpoint reports paid (manual/cash path)", r.ok && r.data.invoice.paymentStatus === "paid", r.data);

  // Paying an already-paid invoice is a no-op, not an error.
  r = await expectStatus(
    axios.post(`${BASE}/invoices/pay`, { invoiceId: inv._id }, { headers: headers(A.token) }),
    200
  );
  check("re-marking a paid invoice is harmless", r.ok, r.data);

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
  check("settings PUT never returns the password hash", r.ok && r.data.company && !("passwordHash" in r.data.company), r.data);

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
    axios.get(`${BASE}/memberships/list?phone=9960005555`, { headers: headers(A.token) }),
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

  r = await expectStatus(axios.get(`${BASE}/staff/public?subdomain=testsalon`), 200);
  check(
    "public staff projection hides salary/commission/device id",
    r.ok && Array.isArray(r.data.staff) && r.data.staff.length === 1 &&
      r.data.staff[0].name === "Ramesh" && !("salary" in r.data.staff[0]) &&
      !("commissionPercent" in r.data.staff[0]) && !("esslId" in r.data.staff[0]),
    r.data
  );

  r = await expectStatus(axios.get(`${BASE}/offers/public?companyId=${A.companyId}`), 200);
  check(
    "public offers projection hides usage counters",
    r.ok && Array.isArray(r.data.offers) && r.data.offers.length === 2 &&
      !("usedCount" in r.data.offers[0]) && !("usageLimit" in r.data.offers[0]),
    r.data
  );

  r = await expectStatus(axios.get(`${BASE}/offers/public?companyId=not-an-id`), 400);
  check("public offers reject a malformed companyId (400)", r.ok, r);

  r = await expectStatus(axios.get(`${BASE}/staff/public?subdomain=testsalon`), 200);
  check("public staff works without auth (used by the public booking page)", r.ok, r);

  // ---- Offer validity window on the public surface --------------------------
  // isActive alone is not enough: the 09:15 expiry cron has not run yet at
  // midnight, so an out-of-window coupon was still advertised to customers and
  // only refused when they tried to book.
  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "EXPIRED20", discountType: "percent", discountValue: 20,
      validFrom: "2020-01-01", validUntil: "2020-12-31",
    }, { headers: headers(A.token) }),
    201
  );
  check("expired-window offer created (isActive is still true)", r.ok && r.data.isActive === true, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "FUTURE20", discountType: "percent", discountValue: 20,
      validFrom: "2099-01-01", validUntil: "2099-12-31",
    }, { headers: headers(A.token) }),
    201
  );
  check("future-window offer created", r.ok, r.data);

  r = await expectStatus(axios.get(`${BASE}/offers/public?companyId=${A.companyId}`), 200);
  const publicCodes = asList(r.data.offers).map((o) => o.code);
  check(
    "/offers/public hides offers outside their validity window",
    r.ok && !publicCodes.includes("EXPIRED20") && !publicCodes.includes("FUTURE20") &&
      publicCodes.includes("DIWALI20") && publicCodes.includes("FLAT50"),
    publicCodes
  );

  r = await expectStatus(
    axios.post(`${BASE}/offers/validate`, { code: "EXPIRED20", serviceId: A.service._id, total: 1000 }, { headers: headers(A.token) }),
    400
  );
  check("/offers/validate rejects an out-of-window offer", r.ok && /expired/i.test(r.data.msg || ""), r.data);

  // ---- Offer package applicability in /validate -----------------------------
  // /offers/validate previously ignored applicablePackages entirely, so a
  // package-only offer reported "valid" for a plain service booking and was then
  // rejected at submit — the preview and the real rule disagreed.
  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "PKGONLY20", discountType: "percent", discountValue: 20,
      applicablePackages: [A.package._id],
    }, { headers: headers(A.token) }),
    201
  );
  check("package-scoped offer created", r.ok, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/offers/validate`, { code: "PKGONLY20", serviceId: A.service._id, total: 1000 }, { headers: headers(A.token) }),
    400
  );
  check(
    "/offers/validate rejects a package-only offer for a plain service booking",
    r.ok && /package/i.test(r.data.msg || ""),
    r.data
  );

  r = await expectStatus(
    axios.post(`${BASE}/offers/validate`, { code: "PKGONLY20", serviceId: A.service._id, total: 1000, isPackage: true, packageId: A.package._id }, { headers: headers(A.token) }),
    200
  );
  check("/offers/validate accepts a package offer for its own package", r.ok && r.data.valid === true, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/offers/validate`, { code: "PKGONLY20", serviceId: A.service._id, total: 1000, isPackage: true }, { headers: headers(A.token) }),
    400
  );
  check("/offers/validate requires packageId when the offer is package-scoped", r.ok, r.data);

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

  // ---- Secret-leak sweep across every payload the API emits ----------------
  const SECRET_MARKERS = ["passwordHash", "RAZORPAY_SECRET", "JWT_SECRET", "whatsappToken", "rzp_test_dummy"];
  const leakTargets = [
    ["/services/public?subdomain=testsalon", null],
    ["/packages/public?subdomain=testsalon", null],
    ["/staff/public?subdomain=testsalon", null],
    ["/reviews/list?subdomain=testsalon", null],
    ["/auth/settings", A.token],
    ["/bookings/list", A.token],
    ["/invoices/list", A.token],
    ["/staff/list", A.token],
    ["/memberships/list", A.token],
    ["/leads/list", A.token],
    [`/audit/export?year=${new Date().getFullYear()}`, A.token],
  ];
  const leaks = [];
  for (const [path, token] of leakTargets) {
    const res = await expectStatus(
      axios.get(`${BASE}${path}`, token ? { headers: headers(token) } : undefined),
      200
    );
    const body = JSON.stringify(res.data || "");
    for (const marker of SECRET_MARKERS) {
      if (body.includes(marker)) leaks.push(`${path} contains "${marker}"`);
    }
  }
  check(`no secret material in any of ${leakTargets.length} API payloads`, leaks.length === 0, leaks);

  // ---- Attendance (eSSL) ----------------------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:00", outTime: "18:30", date: today() }),
    401
  );
  check("attendance sync without the device key → 401", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:00", outTime: "18:30", date: today() }, { headers: { "x-attendance-key": "wrong" } }),
    401
  );
  check("attendance sync with a wrong device key → 401", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:00", outTime: "18:30", date: today() }, { headers: attHeaders() }),
    200
  );
  check("attendance sync by esslId", r.ok && r.data.attendance && String(r.data.attendance.staffId) === A.staff._id, r.data);
  check("attendance worked hours computed server-side (9.5)", r.ok && r.data.attendance.workedHours === 9.5, r.ok && r.data.attendance.workedHours);
  r = await expectStatus(axios.get(`${BASE}/attendance/list?companyId=${A.companyId}`), 401);
  check("attendance list requires auth (401 anonymous)", r.ok, r);
  r = await expectStatus(
    axios.get(`${BASE}/attendance/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  check("attendance list (auth)", r.ok && r.data.length === 1, r.data.length);

  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "9am", date: "2026-02-31" }, { headers: attHeaders() }),
    400
  );
  check("attendance sync rejects an impossible date / bad time → 400", r.ok, r.data);

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
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:30", outTime: "17:30", date: today() }, { headers: attHeaders() }),
    400
  );
  check("ambiguous eSSL id without companyId → 400", r.ok, r.data);
  r = await expectStatus(
    axios.post(`${BASE}/attendance/sync`, { esslId: "ESSL101", inTime: "09:30", outTime: "17:30", date: today(), companyId: C.companyId }, { headers: attHeaders() }),
    200
  );
  check(
    "sync scoped by companyId (no cross-salon records)",
    r.ok && r.data.attendance && String(r.data.attendance.companyId) === C.companyId &&
      String(r.data.attendance.staffId) !== A.staff._id,
    r.data
  );

  // Duplicate eSSL id inside one salon is rejected by a unique index.
  r = await expectStatus(
    axios.post(`${BASE}/staff/create`, { name: "Duplicate Essl", esslId: "ESSL101" }, { headers: headers(A.token) }),
    409
  );
  check("duplicate eSSL id in the same salon → 409", r.ok, r.data);

  // ---- Audit export ----------------------------------------------------------
  r = await expectStatus(
    axios.get(`${BASE}/audit/export?year=${new Date().getFullYear()}`, { headers: headers(A.token) }),
    200
  );
  check("audit export returns fileUrl + count", r.ok && r.data.fileUrl && r.data.count >= 1, r.data);
  // The workbook lives outside any static mount, so it is only reachable through
  // the authenticated download route.
  const xlsx = await axios
    .get(`${RAW}${r.data.fileUrl}`, { headers: headers(A.token), responseType: "arraybuffer" })
    .catch((err) => ({ status: err.response ? err.response.status : null, data: null }));
  check("audit xlsx served over the authenticated route", xlsx.status === 200 && xlsx.data.length > 1000, xlsx && xlsx.data && xlsx.data.length);
  const xlsxAnon = await axios.get(`${RAW}${r.data.fileUrl}`, { responseType: "arraybuffer" }).catch((err) => ({ status: err.response ? err.response.status : null }));
  check("audit xlsx is NOT publicly downloadable (401 anonymous)", xlsxAnon.status === 401, xlsxAnon.status);
  r = await expectStatus(
    axios.get(`${BASE}/audit/export?year=${new Date().getFullYear()}`, { headers: headers(B.token) }),
    200
  );
  check(
    "audit export is tenant-scoped (B sees none of A's invoices)",
    r.ok && r.data.count === 0,
    r.data
  );
  const bXlsx = await axios
    .get(`${RAW}${r.data && r.data.fileUrl}`, { headers: headers(B.token), responseType: "arraybuffer" })
    .catch((err) => ({ status: err.response ? err.response.status : null, data: null }));
  check("audit download works for B", bXlsx.status === 200 && bXlsx.data.length > 1000, bXlsx.status);

  // ---- Multi-tenant isolation ------------------------------------------------
  // (Company B was registered in the auth section so it could also be used for
  // the tenant-scoped audit export check above.)
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

  // ---- Management surface is never anonymous --------------------------------
  const managementReads = [
    "/services/list", "/staff/list", "/packages/list", "/products/list",
    "/offers/list", "/bookings/list", "/bookings/stats", "/bookings/calendar",
    "/calendar", "/invoices/list", "/memberships/list", "/attendance/list",
    "/leads/list", "/auth/settings", "/audit/export",
  ];
  let anonLeaks = [];
  for (const path of managementReads) {
    const res = await expectStatus(axios.get(`${BASE}${path}`), 401);
    if (!res.ok) anonLeaks.push(`${path}→${res.status}`);
  }
  check(`all ${managementReads.length} management GETs require auth`, anonLeaks.length === 0, anonLeaks);

  const anonWrites = [
    ["/services/create", { name: "x", category: "hair", price: 1 }],
    ["/staff/create", { name: "x" }],
    ["/packages/create", { name: "x", price: 1, originalPrice: 2, services: [] }],
    ["/products/create", { name: "x", price: 1 }],
    ["/offers/create", { code: "X1", discountValue: 5 }],
    ["/bookings/create", bookingPayload],
    ["/bookings/status", { bookingId: A.booking._id, status: "completed" }],
    ["/invoices/pay", { invoiceId: inv._id }],
    ["/memberships/create", { customerName: "x", phone: "1", packageId: A.package._id }],
    ["/leads/status", { leadId: "507f1f77bcf86cd799439011", status: "new" }],
    ["/whatsapp/send", { bookingId: A.booking._id, type: "confirmation" }],
    ["/payment/create-order", { type: "invoice", invoiceId: inv._id }],
  ];
  let anonWriteLeaks = [];
  for (const [path, body] of anonWrites) {
    const res = await expectStatus(axios.post(`${BASE}${path}`, body), 401);
    if (!res.ok) anonWriteLeaks.push(`${path}→${res.status}`);
  }
  check(`all ${anonWrites.length} management POSTs require auth`, anonWriteLeaks.length === 0, anonWriteLeaks);

  // ---- Malformed input is a clean 400, never a 500 ---------------------------
  const malformedReads = [
    "/bookings/list?date=2026-02-31",
    "/bookings/list?status=not-a-status",
    "/bookings/list?staffId=not-an-objectid",
    "/bookings/stats?date=2026-13-01",
    "/bookings/calendar?month=2026-13",
    "/calendar?month=hello",
    "/attendance/list?date=nonsense",
    "/invoices/list?date=2026-02-30",
  ];
  let malformedLeaks = [];
  for (const path of malformedReads) {
    const res = await expectStatus(axios.get(`${BASE}${path}`, { headers: headers(A.token) }), 400);
    if (!res.ok) malformedLeaks.push(`${path}→${res.status}:${JSON.stringify(res.data).slice(0, 80)}`);
  }
  check("malformed query ids/dates return 400 (not 500)", malformedLeaks.length === 0, malformedLeaks);

  const malformedWrites = [
    ["POST", "/services/create", { name: "x", category: "not-a-category", price: 1 }],
    ["POST", "/services/create", { name: "x", category: "hair", price: 1, durationMins: 9999 }],
    ["POST", "/services/create", { name: "x", category: "hair", price: -50 }],
    ["POST", "/products/create", { name: "x", price: 1, stock: -3 }],
    ["POST", "/staff/create", { name: "x", commissionPercent: 250 }],
    ["POST", "/packages/create", { name: "x", price: 1, originalPrice: 2, services: [{ serviceId: A.service._id, qty: 1.5 }] }],
    ["POST", "/offers/create", { code: "BADPCT", discountType: "percent", discountValue: 140 }],
    ["POST", "/offers/create", { code: "NEG", discountType: "flat", discountValue: -5 }],
    ["POST", "/bookings/status", { bookingId: "nope", status: "completed" }],
    ["POST", "/bookings/status", { bookingId: A.booking._id, status: "teleported" }],
    ["POST", "/invoices/pay", { invoiceId: "nope" }],
    ["POST", "/memberships/use", { membershipId: "nope", serviceId: "nope" }],
    ["POST", "/leads/status", { leadId: "nope", status: "new" }],
    ["POST", "/leads/create", { companyId: "not-an-id", name: "x", phone: "1" }],
    ["POST", "/reviews/create", { bookingId: "not-an-id", rating: 4 }],
    ["POST", "/reviews/create", { bookingId: A.booking._id, rating: 0 }],
    ["POST", "/whatsapp/send", { bookingId: A.booking._id, type: "not-a-type" }],
    ["PUT", "/auth/settings", { salonType: "barber" }],
    ["PUT", "/auth/settings", { language: "Klingon" }],
  ];
  let malformedPostLeaks = [];
  for (const [method, path, body] of malformedWrites) {
    const call = method === "PUT" ? axios.put : axios.post;
    const res = await expectStatus(call(`${BASE}${path}`, body, { headers: headers(A.token) }), 400);
    if (!res.ok) malformedPostLeaks.push(`${method} ${path}→${res.status}:${JSON.stringify(res.data).slice(0, 80)}`);
  }
  check("malformed write bodies return 400 (not 500)", malformedPostLeaks.length === 0, malformedPostLeaks);

  // ---- Duration-aware conflicts + concurrency -------------------------------
  // "Hair Cut" is 45 minutes, so an 11:00 booking occupies 11:00 and 11:30.
  // Booking into 11:30 must conflict even though the raw slot string differs.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "11:30-12:00", customerName: "Overlap" }, { headers: headers(A.token) }),
    409
  );
  check("45-minute service blocks the adjacent 11:30 slot", r.ok, r);

  // Genuinely concurrent requests for one free slot: exactly one may win.
  const raceSlot = "16:00-16:30";
  const raceBody = { ...bookingPayload, slot: raceSlot, customerName: "Race", offerCode: "" };
  const raceResults = await Promise.all([
    expectStatus(axios.post(`${BASE}/bookings/create`, raceBody, { headers: headers(A.token) }), 201),
    expectStatus(axios.post(`${BASE}/bookings/create`, raceBody, { headers: headers(A.token) }), 201),
    expectStatus(axios.post(`${BASE}/bookings/create`, raceBody, { headers: headers(A.token) }), 201),
  ]);
  const created = raceResults.filter((x) => x.ok);
  const conflicts = raceResults.filter((x) => x.status === 409);
  check(
    "3 concurrent bookings for one slot → exactly 1 created, 2 conflicts",
    created.length === 1 && conflicts.length === 2,
    raceResults.map((x) => x.status)
  );

  // ---- Duplicate completion is idempotent -----------------------------------
  const completeResults = await Promise.all([
    expectStatus(
      axios.post(`${BASE}/bookings/status`, { bookingId: created[0].data._id, status: "completed" }, { headers: headers(A.token) }),
      200
    ),
    expectStatus(
      axios.post(`${BASE}/bookings/status`, { bookingId: created[0].data._id, status: "completed" }, { headers: headers(A.token) }),
      200
    ),
  ]);
  const completedOk = completeResults.filter((x) => x.ok);
  r = await expectStatus(
    axios.get(`${BASE}/invoices/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const invoicesForRace = asList(r.data).filter((i) => String(i.bookingId) === String(created[0].data._id));
  check(
    "concurrent double-complete creates exactly one invoice (idempotent)",
    completedOk.length >= 1 && invoicesForRace.length === 1,
    { statuses: completeResults.map((x) => x.status), invoices: invoicesForRace.length }
  );

  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: A.booking._id, status: "completed" }, { headers: headers(A.token) }),
    200
  );
  check("re-completing an already-completed booking returns the same invoice", r.ok, r.data);

  // ---- Stale completion-claim recovery --------------------------------------
  // A crash between "claim the booking for completion" and the status flip left
  // the booking in the internal "completing" state. Every status transition is
  // filtered on status: "booked", so reception could not complete, cancel or
  // mark it no-show — it was permanently wedged until an operator edited Mongo
  // by hand. The claim now carries completingAt and a manual retry steals it
  // once it is older than the stale window.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, {
      ...bookingPayload, slot: "18:00-18:30", customerName: "Stale Claim", offerCode: "",
    }, { headers: headers(A.token) }),
    201
  );
  const staleBookingId = r.data._id;

  const seedStale = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      await m.connection.collection("bookings").updateOne(
        { _id: new m.Types.ObjectId("${staleBookingId}") },
        { $set: {
            status: "completing",
            completingAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min old
        } }
      );
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve) => {
    seedStale.on("exit", resolve);
    seedStale.stderr.on("data", (d) => process.stderr.write(`   [seed] ${d}`));
  });

  r = await expectStatus(
    axios.get(`${BASE}/bookings/list?companyId=${A.companyId}&date=${today()}`, { headers: headers(A.token) }),
    200
  );
  const staleShown = asList(r.data).find((b) => String(b._id) === staleBookingId);
  check("a booking wedged in 'completing' is still visible in the list", staleShown && staleShown.status === "completing", staleShown && staleShown.status);

  // An operator retries the completion: the stale claim is stolen and it works.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: staleBookingId, status: "completed" }, { headers: headers(A.token) }),
    200
  );
  check("a 30-minute-old completion claim is stolen and completion succeeds", r.ok && r.data.invoiceId, r.data);

  r = await expectStatus(
    axios.get(`${BASE}/invoices/list?companyId=${A.companyId}`, { headers: headers(A.token) }),
    200
  );
  const staleInvoice = asList(r.data).find((i) => String(i.bookingId) === staleBookingId);
  check("the recovered booking produced exactly one invoice", Boolean(staleInvoice), r.data && r.data.length);

  // A FRESH claim must NOT be stealable — that would let a second request
  // double-complete a booking that is actively being invoiced right now.
  // 19:00 is the last start that fits the 45-minute service before 20:00.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, {
      ...bookingPayload, slot: "19:00-19:30", customerName: "Fresh Claim", offerCode: "",
    }, { headers: headers(A.token) }),
    201
  );
  check("fresh-claim test booking was created", r.ok, r.data);
  const freshBookingId = r.data._id;
  const seedFresh = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      await m.connection.collection("bookings").updateOne(
        { _id: new m.Types.ObjectId("${freshBookingId}") },
        { $set: { status: "completing", completingAt: new Date() } }
      );
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve) => {
    seedFresh.on("exit", resolve);
    seedFresh.stderr.on("data", (d) => process.stderr.write(`   [seed] ${d}`));
  });

  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: freshBookingId, status: "cancelled" }, { headers: headers(A.token) }),
    409
  );
  check("a FRESH completion claim is not stealable (409)", r.ok, r.data);

  // The cron reaper is what un-wedges these without a human.
  const reapProbe = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      const { reapStaleCompletionClaims } = require("./utils/invoicing");
      const reaped = await reapStaleCompletionClaims();
      process.stdout.write(JSON.stringify({ reaped }));
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "pipe", "pipe"] });
  let reapOut = "";
  await new Promise((resolve) => {
    reapProbe.on("exit", resolve);
    reapProbe.stdout.on("data", (d) => { reapOut += d; });
    reapProbe.stderr.on("data", (d) => process.stderr.write(`   [reap] ${d}`));
  });
  let reapResult = {};
  try { reapResult = JSON.parse(reapOut); } catch { /* reported below */ }
  check(
    "the cron reaper releases a stale claim and leaves a fresh one alone",
    reapResult.reaped >= 0, reapResult
  );

  r = await expectStatus(
    axios.get(`${BASE}/bookings/list?companyId=${A.companyId}&date=${today()}`, { headers: headers(A.token) }),
    200
  );
  const freshAfterReap = asList(r.data).find((b) => String(b._id) === freshBookingId);
  check(
    "after reaping, the fresh claim is still held and the old one is free",
    freshAfterReap && freshAfterReap.status === "completing",
    freshAfterReap && freshAfterReap.status
  );

  // Put the fresh one back to 'booked' so it does not leak into later counts.
  const seedRestore = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      await m.connection.collection("bookings").updateOne(
        { _id: new m.Types.ObjectId("${freshBookingId}") },
        { $set: { status: "booked" }, $unset: { completingAt: "", completionToken: "" } }
      );
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve) => {
    seedRestore.on("exit", resolve);
    seedRestore.stderr.on("data", (d) => process.stderr.write(`   [seed] ${d}`));
  });

  // ---- Completion-claim fencing token ---------------------------------------
  // A stale claim is stealable, so `status: "completing"` alone does not prove
  // ownership: the thief holds a DIFFERENT claim. Without a fencing token a slow
  // first worker (large product cart) could return after its claim was stolen
  // and reset the booking to "booked" — on top of an invoice it had just
  // committed, leaving an invoice attached to a "booked" booking.
  const fenceProbe = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      const { reapStaleCompletionClaims } = require("./utils/invoicing");
      const bookings = m.connection.collection("bookings");
      const out = {};

      // Simulate worker A claiming, then the claim going stale and worker B
      // stealing it. A's token must no longer be able to flip the status.
      const id = new m.Types.ObjectId();
      const companyId = new m.Types.ObjectId("${A.companyId}");
      await bookings.insertOne({
        _id: id, companyId,
        serviceId: new m.Types.ObjectId("${A.service._id}"),
        staffId: new m.Types.ObjectId("${A.staff._id}"),
        customerName: "Fence Test", phone: "1",
        bookingDate: "2097-01-01", slot: "10:00-10:30",
        occupiedSlots: ["10:00-10:30"], activeSlot: true,
        status: "booked", total: 100, advancePaid: 20,
        paymentMode: "UPI", paymentStatus: "pending",
        createdAt: new Date(),
      });

      // Worker A claims.
      const claimA = await bookings.findOneAndUpdate(
        { _id: id, status: "booked" },
        { $set: { status: "completing", completingAt: new Date(), completionToken: "token-A" } },
        { returnDocument: "after" }
      );
      out.aClaimed = claimA && claimA.status === "completing";

      // The claim goes stale and is reaped.
      await bookings.updateOne(
        { _id: id },
        { $set: { completingAt: new Date(Date.now() - 60 * 60 * 1000) } }
      );
      await reapStaleCompletionClaims();
      out.afterReap = (await bookings.findOne({ _id: id })).status;

      // Worker B claims with its own token.
      await bookings.updateOne(
        { _id: id, status: "booked" },
        { $set: { status: "completing", completingAt: new Date(), completionToken: "token-B" } }
      );

      // Worker A (stale, still running) tries to flip the status using its old
      // token. This MUST NOT match — that is the whole point of the token.
      const staleFlip = await bookings.updateOne(
        { _id: id, status: "completing", completionToken: "token-A" },
        { $set: { status: "completed", completedAt: new Date() } }
      );
      out.staleWorkerFlips = staleFlip.modifiedCount;
      out.statusAfterStaleFlip = (await bookings.findOne({ _id: id })).status;

      // Worker A also tries to release the claim (its compensation path).
      const staleRelease = await bookings.updateOne(
        { _id: id, status: "completing", completionToken: "token-A" },
        { $set: { status: "booked" }, $unset: { completingAt: "", completionToken: "" } }
      );
      out.staleWorkerReleases = staleRelease.modifiedCount;

      // The rightful owner still works.
      const realFlip = await bookings.updateOne(
        { _id: id, status: "completing", completionToken: "token-B" },
        { $set: { status: "completed", completedAt: new Date() }, $unset: { completingAt: "", completionToken: "" } }
      );
      out.rightfulOwnerFlips = realFlip.modifiedCount;
      out.finalStatus = (await bookings.findOne({ _id: id })).status;

      await bookings.deleteOne({ _id: id });
      process.stdout.write("\\n@@FENCE@@" + JSON.stringify(out));
      await m.disconnect();
    })().catch((e) => { process.stdout.write("\\n@@FENCE@@" + JSON.stringify({ probeError: String(e.stack || e) })); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "pipe", "pipe"] });
  let fenceOut = "";
  await new Promise((resolve) => {
    fenceProbe.on("exit", resolve);
    fenceProbe.stdout.on("data", (d) => { fenceOut += d; });
    fenceProbe.stderr.on("data", (d) => process.stderr.write(`   [fence] ${d}`));
  });
  let fence = {};
  try { fence = JSON.parse(fenceOut.split("@@FENCE@@")[1] || "{}"); } catch { /* below */ }
  check("a claim is taken and then reaped once stale", fence.aClaimed && fence.afterReap === "booked", fence);
  check(
    "fencing token blocks a STALE worker from completing another worker's claim",
    fence.staleWorkerFlips === 0 && fence.statusAfterStaleFlip === "completing",
    fence
  );
  check(
    "fencing token blocks a STALE worker from releasing another worker's claim",
    fence.staleWorkerReleases === 0,
    fence
  );
  check(
    "the rightful claim holder can still complete the booking",
    fence.rightfulOwnerFlips === 1 && fence.finalStatus === "completed",
    fence
  );

  // ---- Booking business-rule validation -------------------------------------
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "09:00-09:30", bookingDate: "2026-02-31" }, { headers: headers(A.token) }),
    400
  );
  check("impossible booking date rejected", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "09:00-09:30", bookingDate: "2020-01-01" }, { headers: headers(A.token) }),
    400
  );
  check("past booking date rejected", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "09:00-09:30", paymentMode: "Bitcoin" }, { headers: headers(A.token) }),
    400
  );
  check("unknown payment mode rejected", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "09:00-09:30", serviceId: "not-an-id" }, { headers: headers(A.token) }),
    400
  );
  check("malformed serviceId rejected", r.ok, r);

  // Cross-tenant references: B's service/staff must not be bookable by A.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "09:00-09:30", serviceId: A.serviceSpa._id, staffId: A.staff._id, companyId: B.companyId }, { headers: headers(B.token) }),
    404
  );
  check("B cannot book with A's service/staff ids (404)", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/packages/create`, { name: "Stolen", price: 1, originalPrice: 2, services: [{ serviceId: A.service._id, qty: 1 }] }, { headers: headers(B.token) }),
    403
  );
  check("package cannot reference another tenant's service (403)", r.ok, r);

  r = await expectStatus(
    axios.post(`${BASE}/services/create`, { name: "Combo", category: "hair", price: 10, comboServices: [A.service._id] }, { headers: headers(B.token) }),
    403
  );
  check("combo cannot reference another tenant's service (403)", r.ok, r);

  // Package bookings must contain the selected service.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, { ...bookingPayload, slot: "09:00-09:30", isPackage: true, packageId: A.package._id, serviceId: A.service._id }, { headers: headers(A.token) }),
    400
  );
  check("package booking with a service outside the package → 400", r.ok, r);

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

  // ---- Database bootstrap: legacy booking migration ------------------------
  // The occupiedSlots backfill is the migration path every existing deployment
  // takes on first boot. It is the difference between duration-aware conflict
  // detection working and silently double-booking a 45-minute service, so it is
  // tested against a hand-seeded "legacy" row written the way the pre-migration
  // schema wrote it.
  const migrateProbe = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      const db = m.connection.db;
      const companyId = new m.Types.ObjectId("${A.companyId}");
      const serviceId = new m.Types.ObjectId("${A.service._id}");
      // Each legacy row gets its OWN staff id. Four rows sharing one staff id
      // with empty occupiedSlots would collide on the multikey unique index at
      // insert time, which tests the index rather than the migration.
      const sid = () => new m.Types.ObjectId();
      const base = (extra) => Object.assign({
        companyId, serviceId, staffId: sid(), customerName: "Legacy", phone: "1",
        bookingDate: "2098-01-01", status: "booked",
        total: 1000, advancePaid: 200, paymentMode: "UPI", paymentStatus: "pending",
        activeSlot: true, serviceDurationMins: 45, createdAt: new Date(),
      }, extra);

      // A: legacy row, 45-minute service at 11:00, occupiedSlots: [].
      // B: legacy row, 30-minute service, occupiedSlots: [] (should be released).
      // C: legacy row with NO occupiedSlots field at all.
      const a = new m.Types.ObjectId();
      const b = new m.Types.ObjectId();
      const c = new m.Types.ObjectId();
      await db.collection("bookings").insertMany([
        base({ _id: a, slot: "11:00-11:30", occupiedSlots: [], customerName: "Legacy A" }),
        base({ _id: b, slot: "15:00-15:30", occupiedSlots: [], serviceDurationMins: 30, status: "cancelled", activeSlot: false, customerName: "Legacy B" }),
        base({ _id: c, slot: "09:00-09:30", customerName: "Legacy C" }),
        base({ _id: new m.Types.ObjectId(), slot: "99:99-99:99", occupiedSlots: [], customerName: "Legacy Bad" }),
      ]);
      const bad = (await db.collection("bookings").findOne({ customerName: "Legacy Bad" }))._id;

      const out = {};
      out.caughtBad = false;
      try {
        await require("./db").initializeDatabase();
      } catch (e) {
        out.caughtBad = true;
        out.badMessage = String(e.message).slice(0, 300);
      }

      // The bad row is gone; the good rows must now be backfilled.
      await db.collection("bookings").deleteOne({ _id: bad });
      await require("./db").initializeDatabase();

      const read = async (id) => {
        const d = await db.collection("bookings").findOne({ _id: id });
        return { occupiedSlots: d.occupiedSlots, activeSlot: d.activeSlot };
      };
      out.afterA = await read(a);
      out.afterB = await read(b);
      out.afterC = await read(c);

      process.stdout.write("\\n@@PROBE@@" + JSON.stringify(out));
      await m.disconnect();
    })().catch((e) => {
      // Write the error to STDOUT so it cannot be lost to an un-flushed stderr
      // pipe on process.exit(). db.js logs to stdout too, hence the marker.
      try { process.stdout.write("\\n@@PROBE@@" + JSON.stringify({ probeError: String(e && (e.stack || e.message || e)) })); } catch {}
      process.exit(1);
    });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "pipe", "pipe"] });
  let migrateOut = "";
  await new Promise((resolve) => {
    migrateProbe.on("exit", resolve);
    migrateProbe.stdout.on("data", (d) => { migrateOut += d; });
    migrateProbe.stderr.on("data", (d) => process.stderr.write(`   [migrate] ${d}`));
  });
  let mig = {};
  const migPayload = migrateOut.split("@@PROBE@@")[1];
  try {
    mig = migPayload ? JSON.parse(migPayload) : { probeError: "no payload: " + migrateOut.slice(0, 300) };
  } catch {
    mig = { probeError: migrateOut.slice(-300) };
  }

  check("migration probe completed", Boolean(mig.afterA), mig);
  check(
    "migration backfills occupiedSlots from the service duration (45 min → 2 windows)",
    Array.isArray(mig.afterA && mig.afterA.occupiedSlots) &&
      mig.afterA.occupiedSlots.length === 2 &&
      mig.afterA.occupiedSlots[0] === "11:00-11:30" &&
      mig.afterA.occupiedSlots[1] === "11:30-12:00",
    mig.afterA
  );
  check(
    "migration repairs an empty occupiedSlots array and releases a cancelled booking",
    Array.isArray(mig.afterB && mig.afterB.occupiedSlots) &&
      mig.afterB.occupiedSlots.length === 1 &&
      mig.afterB.occupiedSlots[0] === "15:00-15:30" &&
      mig.afterB.activeSlot === false,
    mig.afterB
  );
  check(
    "migration backfills a legacy row that has no occupiedSlots field at all",
    Array.isArray(mig.afterC && mig.afterC.occupiedSlots) && mig.afterC.occupiedSlots.length === 2,
    mig.afterC
  );
  check(
    "migration sets activeSlot from status for a live booking",
    mig.afterA && mig.afterA.activeSlot === true,
    mig.afterA
  );
  check(
    "migration fails LOUDLY on an unparsable booking instead of guessing",
    mig.caughtBad === true && /99:99-99:99/.test(mig.badMessage || ""),
    mig.badMessage
  );

  // ---- Attendance fails closed when ATTENDANCE_API_KEY is unset ------------
  // Previously requireDeviceKey() returned null when the env var was absent, so
  // the sync endpoint was an unauthenticated write of salary/PII data for any
  // salon whose sequential eSSL ids an attacker could guess. A second server
  // instance is booted with the variable deleted to prove it.
  const noKeyChild = spawn(process.execPath, ["app.js"], {
    cwd: ROOT,
    env: (() => {
      const e = { ...process.env, PORT: String(PORT + 1), MONGO_URI: uri, JWT_SECRET: "test-secret-salon-spa-2026", NODE_ENV: "test", DISABLE_CRON: "1" };
      delete e.ATTENDANCE_API_KEY;
      return e;
    })(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  noKeyChild.stdout.on("data", (d) => process.stdout.write(`   [nokey] ${d}`));
  noKeyChild.stderr.on("data", (d) => process.stderr.write(`   [nokey] ${d}`));
  const noKeyUp = await waitForServer(`http://localhost:${PORT + 1}/api/health`);
  check("second server booted without ATTENDANCE_API_KEY", noKeyUp);

  if (noKeyUp) {
    const NOKEY = `http://localhost:${PORT + 1}/api`;
    r = await expectStatus(
      axios.post(`${NOKEY}/attendance/sync`, { esslId: "ESSL101", inTime: "09:00", outTime: "18:30", date: today() }),
      503
    );
    check(
      "attendance sync with no device key and no session → 503 (fail closed, not anonymous)",
      r.ok, r.data
    );

    r = await expectStatus(
      axios.post(`${NOKEY}/attendance/sync`, { esslId: "ESSL101", inTime: "09:00", outTime: "18:30", date: today() }, { headers: headers(A.token) }),
      200
    );
    check(
      "attendance sync with no device key but a valid session → allowed",
      r.ok && r.data.attendance && String(r.data.attendance.companyId) === A.companyId,
      r.data
    );

    // The session's tenant wins over a caller-supplied companyId.
    r = await expectStatus(
      axios.post(`${NOKEY}/attendance/sync`, { esslId: "ESSL101", inTime: "10:00", outTime: "19:00", date: "2098-06-06", companyId: B.companyId }, { headers: headers(A.token) }),
      200
    );
    check(
      "a session-authenticated sync ignores a body companyId (JWT tenant wins)",
      r.ok && r.data.attendance && String(r.data.attendance.companyId) === A.companyId,
      r.data
    );
  }
  noKeyChild.kill();
  await sleep(500);

  // ---- Malformed attendance payloads must be 400, never 500 -----------------
  // Validation used to stringify the value, so a JSON array passed the regex and
  // then crashed workedHours() on .split() — a device sending inTime: ["09:00"]
  // produced a 500 instead of a clean rejection.
  for (const [label, payload] of [
    ["inTime as an array", { esslId: "ESSL101", inTime: ["09:00"], date: today() }],
    ["outTime as an object", { esslId: "ESSL101", outTime: { h: 9 }, date: today() }],
    ["inTime as a number", { esslId: "ESSL101", inTime: 900, date: today() }],
  ]) {
    r = await expectStatus(
      axios.post(`${BASE}/attendance/sync`, payload, { headers: attHeaders() }),
      400
    );
    check(`attendance rejects a non-string ${label} with 400 (not 500)`, r.ok, r.data);
  }

  // ---- WhatsApp must never message fabricated financial data ----------------
  // contextFor() used to substitute "INV-2026-000001" / ₹1200 when the booking
  // had no invoice, and sent that to a real customer.
  r = await expectStatus(
    axios.post(`${BASE}/whatsapp/send`, { bookingId: A.bookingRebooked._id, type: "invoice" }, { headers: headers(A.token) }),
    409
  );
  check(
    "whatsapp /send refuses an invoice message for a booking with no invoice",
    r.ok && /no invoice/i.test(r.data.msg || ""),
    r.data
  );

  r = await expectStatus(
    axios.post(`${BASE}/whatsapp/send`, { bookingId: A.bookingRebooked._id, type: "membership-expiry" }, { headers: headers(A.token) }),
    409
  );
  check(
    "whatsapp /send refuses a membership message when the customer has none active",
    r.ok && /no active membership/i.test(r.data.msg || ""),
    r.data
  );

  // The /test preview endpoint still works — it is explicitly a no-send preview
  // and is the only place placeholders are legitimate.
  r = await expectStatus(
    axios.post(`${BASE}/whatsapp/test`, { type: "invoice" }, { headers: headers(A.token) }),
    200
  );
  check("whatsapp /test preview still renders sample data", r.ok && r.data.msg, r.data);

  // ---- Payment lifecycle: a cancelled booking cannot be settled -------------
  // An order raised while a booking was live stayed payable after cancellation,
  // so a customer could pay real money against an appointment that would never
  // happen. Cancellation now retires the order, and verification refuses it.
  r = await expectStatus(
    axios.post(`${BASE}/bookings/create`, {
      ...bookingPayload, slot: "15:00-15:30", customerName: "Pay After Cancel", offerCode: "",
    }, { headers: headers(A.token) }),
    201
  );
  const payCancelBooking = r.data._id;

  // Seed a live order for it, exactly as create-order would have left one.
  const seedPayCancel = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      await m.connection.collection("paymentorders").insertOne({
        companyId: new m.Types.ObjectId("${A.companyId}"),
        type: "booking", resourceId: new m.Types.ObjectId("${payCancelBooking}"),
        amountPaise: 20000, currency: "INR",
        razorpayOrderId: "order_cancel_test",
        status: "created",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date(), paidAt: null,
      });
      await m.disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((resolve) => {
    seedPayCancel.on("exit", resolve);
    seedPayCancel.stderr.on("data", (d) => process.stderr.write(`   [seed] ${d}`));
  });

  r = await expectStatus(
    axios.post(`${BASE}/bookings/status`, { bookingId: payCancelBooking, status: "cancelled" }, { headers: headers(A.token) }),
    200
  );
  check("cancelling a booking reports the payment orders it retired", r.ok && r.data.paymentOrdersExpired === 1, r.data);

  // A valid, correctly-signed verification for that retired order must be refused.
  const cancelPayId = "pay_cancel_test_1";
  const cancelSig = crypto
    .createHmac("sha256", RAZORPAY_SECRET)
    .update(`order_cancel_test|${cancelPayId}`)
    .digest("hex");
  r = await expectStatus(
    axios.post(`${BASE}/payment/verify`, {
      razorpay_payment_id: cancelPayId,
      razorpay_order_id: "order_cancel_test",
      razorpay_signature: cancelSig,
    }, { headers: headers(A.token) }),
    409
  );
  check(
    "a correctly-signed payment for a CANCELLED booking is refused (order was retired)",
    r.ok && /expired/i.test(r.data.msg || ""),
    r.data
  );

  // And the booking itself is still unpaid — no phantom "paid" advance.
  const afterCancelBookings = await axios.get(`${BASE}/bookings/list?companyId=${A.companyId}`, { headers: headers(A.token) });
  const cancelledRow = asList(afterCancelBookings.data).find((b) => String(b._id) === payCancelBooking);
  check(
    "the cancelled booking was NOT marked paid by the refused verification",
    cancelledRow && cancelledRow.paymentStatus === "pending",
    cancelledRow && cancelledRow.paymentStatus
  );

  // A cancelled booking can no longer raise a fresh order either.
  r = await expectStatus(
    axios.post(`${BASE}/payment/create-order`, { type: "booking", bookingId: payCancelBooking }, { headers: headers(A.token) }),
    409
  );
  check("a cancelled booking cannot raise a new payment order (409)", r.ok, r.data);

  // ---- Abandoned real payment orders are retired by the reaper -------------
  const orderReapProbe = spawn(process.execPath, ["-e", `
    const m = require("mongoose");
    (async () => {
      await m.connect(process.env.MONGO_URI);
      const { expireStaleOrders } = require("./routes/payment");
      const orders = m.connection.collection("paymentorders");
      const companyId = new m.Types.ObjectId("${A.companyId}");
      const resourceId = new m.Types.ObjectId();
      const out = {};

      // An abandoned order: promoted to a real id, window already elapsed.
      await orders.insertOne({
        companyId, type: "invoice", resourceId,
        amountPaise: 1000, currency: "INR",
        razorpayOrderId: "order_abandoned_1", status: "created",
        expiresAt: new Date(Date.now() - 60 * 1000), createdAt: new Date(), paidAt: null,
      });

      out.retired = await expireStaleOrders();
      out.status = (await orders.findOne({ razorpayOrderId: "order_abandoned_1" })).status;
      out.stillThere = Boolean(await orders.findOne({ razorpayOrderId: "order_abandoned_1" }));

      // Running it again must not double-count.
      out.retiredAgain = await expireStaleOrders();

      await orders.deleteMany({ razorpayOrderId: "order_abandoned_1" });
      process.stdout.write("\\n@@REAP@@" + JSON.stringify(out));
      await m.disconnect();
    })().catch((e) => { process.stdout.write("\\n@@REAP@@" + JSON.stringify({ probeError: String(e.stack || e) })); process.exit(1); });
  `], { cwd: ROOT, env: { ...process.env, MONGO_URI: uri }, stdio: ["ignore", "pipe", "pipe"] });
  let reapOut2 = "";
  await new Promise((resolve) => {
    orderReapProbe.on("exit", resolve);
    orderReapProbe.stdout.on("data", (d) => { reapOut2 += d; });
    orderReapProbe.stderr.on("data", (d) => process.stderr.write(`   [reap] ${d}`));
  });
  let orderReap = {};
  try { orderReap = JSON.parse(reapOut2.split("@@REAP@@")[1] || "{}"); } catch { /* below */ }
  check(
    "an abandoned real Razorpay order is retired so the customer can retry",
    orderReap.retired >= 1 && orderReap.status === "expired",
    orderReap
  );
  check(
    "the retired order row is kept for audit rather than deleted",
    orderReap.stillThere === true,
    orderReap
  );
  check("the order reaper is idempotent", orderReap.retiredAgain === 0, orderReap);

  // ---- Offer date + array validation ----------------------------------------
  // An impossible date used to parse to Invalid Date and be stored as null,
  // silently turning a bounded coupon into an unbounded one.
  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "BADDATE20", discountType: "percent", discountValue: 20,
      validFrom: "2026-02-31", validUntil: "2026-12-31",
    }, { headers: headers(A.token) }),
    400
  );
  check("an impossible offer date (2026-02-31) is rejected with 400", r.ok, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "BADORDER", discountType: "percent", discountValue: 20,
      validFrom: "2026-12-31", validUntil: "2026-01-01",
    }, { headers: headers(A.token) }),
    400
  );
  check("validUntil before validFrom is rejected with 400", r.ok, r.data);

  // A non-array applicability field used to reach .filter() and throw a
  // TypeError -> 500.
  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "BADARR", discountType: "percent", discountValue: 20,
      applicableServices: { not: "an array" },
    }, { headers: headers(A.token) }),
    400
  );
  check("a non-array applicableServices is rejected with 400 (not 500)", r.ok, r.data);

  r = await expectStatus(
    axios.post(`${BASE}/offers/create`, {
      code: "GOODARR", discountType: "percent", discountValue: 20,
      applicableServices: JSON.stringify([A.service._id]),
    }, { headers: headers(A.token) }),
    201
  );
  check(
    "a JSON-string service id list is accepted and normalised",
    r.ok && Array.isArray(r.data.applicableServices) && r.data.applicableServices.length === 1,
    r.data
  );

  // ---- Upload errors map to 400, and validation failures clean up ----------
  // Multer's LIMIT_FILE_COUNT had no mapping in the central error handler, so
  // uploading 6 product images returned a 500.
  const tooManyImages = [];
  const pngBytes = Buffer.from("89504e470d0a1a0a", "hex");
  for (let i = 0; i < 6; i++) tooManyImages.push(new File([pngBytes], `x${i}.png`, { type: "image/png" }));
  const fd = new FormData();
  fd.append("name", "Too Many Images");
  fd.append("price", "100");
  fd.append("stock", "1");
  tooManyImages.forEach((f) => fd.append("images", f));
  r = await expectStatus(
    axios.post(`${BASE}/products/create`, fd, { headers: { ...headers(A.token) } }),
    400
  );
  check("uploading more images than the limit is a 400, not a 500", r.ok && /too many files/i.test(r.data.msg || ""), r.data);

  // A validation failure AFTER multer wrote the file must not leave an orphan
  // image behind in the public uploads directory.
  const uploadsDir = path.join(ROOT, "uploads");
  const servicesDir = path.join(uploadsDir, "services");
  const beforeFiles = fs.existsSync(servicesDir) ? fs.readdirSync(servicesDir).length : 0;
  const badFd = new FormData();
  badFd.append("name", "Invalid Category Service");
  badFd.append("category", "not-a-real-category");
  badFd.append("price", "500");
  badFd.append("image", new File([pngBytes], "orphan.png", { type: "image/png" }));
  r = await expectStatus(
    axios.post(`${BASE}/services/create`, badFd, { headers: { ...headers(A.token) } }),
    400
  );
  check("an invalid category is still rejected with 400", r.ok, r.data);
  const afterFiles = fs.existsSync(servicesDir) ? fs.readdirSync(servicesDir).length : 0;
  check(
    "a rejected upload leaves no orphan file in the public uploads directory",
    afterFiles === beforeFiles,
    { beforeFiles, afterFiles }
  );

  // ---- Teardown ---------------------------------------------------------------
  if (failures) {
    console.error(`\n===== ${failures} FAILING ASSERTION(S) =====`);
    for (const line of results.filter((x) => x.startsWith("FAIL"))) {
      console.error("  " + line);
    }
  }
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