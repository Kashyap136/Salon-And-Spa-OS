# Salon & Spa OS — Backend

REST API for Salon & Spa OS. Node.js + Express + MongoDB (Mongoose), built to match
the existing Next.js frontend (`Frontend/`) in this repository.

API base: `http://localhost:5005/api` (default port `5005`).

---

## 1. Setup

```bash
cd backend
npm install
cp .env.example .env.local    # then fill in real values
npm start                      # or `npm run dev`
```

Requirements: Node.js ≥ 18, and a MongoDB instance (local `mongod` or Atlas).

The server boots with:

```text
[db] connected to MongoDB (salon_spa_os)
[cron] scheduled jobs registered
[server] Salon & Spa OS backend listening on http://localhost:5005
```

Health check: `GET /api/health` → `{ ok: true, service: "salon-spa-os-backend" }`.

## 2. Environment variables

See `.env.example` for the full annotated list.

| Variable            | Purpose                                                    | Required in production |
| ------------------- | ---------------------------------------------------------- | --------------------- |
| `PORT`              | Server port (default `5005`)                               | no                    |
| `NODE_ENV`          | `production` enables the startup guard (§2) and makes `DISABLE_CRON` a no-op | no            |
| `MONGO_URI`         | MongoDB connection string (local or Atlas)                 | **yes**               |
| `MONGO_DB`          | Optional database name override                            | no                    |
| `DNS_SERVERS`       | Optional — comma-separated resolvers to pin Node's DNS (see §3) | no               |
| `JWT_SECRET`        | Secret used to sign auth tokens (≥ 32 random bytes)        | **yes**               |
| `CORS_ORIGIN`       | Comma-separated allowlist of browser origins (`FRONTEND_URL` is accepted as a legacy alias) | **yes** |
| `RAZORPAY_KEY`      | Razorpay key id                                            | no                    |
| `RAZORPAY_SECRET`   | Razorpay key secret (payment signature verification)       | no                    |
| `WHATSAPP_TOKEN`    | Meta Cloud API bearer token                                | no                    |
| `WHATSAPP_PHONE_ID` | Meta WhatsApp phone number id                              | no                    |
| `ATTENDANCE_API_KEY`| Shared secret for eSSL device sync (`x-attendance-key`)    | no                    |
| `UPI_ID`            | UPI id used in booking confirmations / invoice QR codes    | no                    |
| `TZ`                | Cron timezone (default `Asia/Kolkata`)                     | no                    |
| `DISABLE_CRON`      | Start the API with the background timers parked. **Ignored, with a warning, when `NODE_ENV=production`** (see §7) | no |

### Production startup guard

When `NODE_ENV=production` the server **refuses to boot** unless `JWT_SECRET`,
`MONGO_URI` and a CORS allowlist are all set, and it names every missing one:

```
Failed to start backend: required in production but not set — JWT_SECRET, MONGO_URI
```

Each of those three changes behaviour rather than breaking a request, which is
exactly why a hard stop is needed: without them a live deployment would sign
tokens with a shared secret, point at a database that is not there, and serve
every origin to a multi-tenant API. Outside production, `MONGO_URI` falls back to
`mongodb://localhost:27017/salon_spa_os` **and logs a warning**.

### Integration mode is reported, not assumed

On every boot the server logs which external integrations will really reach
their provider:

```
[config] 3/3 integrations are NOT configured — WhatsApp (Meta Cloud API)
(messages are logged locally and NOT delivered); Razorpay (checkout is
unavailable; settle by UPI/cash); eSSL attendance devices (device sync is
disabled (owner-signed sync still works))
```

Missing optional integrations never stop the boot — a salon can legitimately run
UPI/cash only — but the state is stated explicitly so "3 reminders queued" is
never mistaken for "3 reminders delivered".

No real credentials are committed. The backend falls back to a **mock WhatsApp
mode** and guarded errors when credentials are absent — the app never crashes for
missing external configuration. `POST /api/whatsapp/send` reports
`mocked: true` in that case; the WhatsApp message **body** is never logged (only
the recipient's last four digits and the character count).

## 3. MongoDB

Database: `salon_spa_os` (overridable via `MONGO_DB`). Supports local MongoDB and
Atlas. No credentials are hard-coded.

**Atlas SRV / DNS resilience.** `mongodb+srv://` depends on DNS SRV records, and some
machines/networks (VPNs, security suites) block SRV queries to the official resolvers —
surfacing as `querySrv ECONNREFUSED / ENOTFOUND / EAI_AGAIN`. The server handles this
without abandoning the SRV scheme:

1. Set `DNS_SERVERS=8.8.8.8,1.1.1.1` (comma-separated) to pin Node's resolver at boot,
   or
2. rely on the automatic fallback: if the first connect fails with an SRV/DNS symptom,
   the server retries once using public resolvers (`8.8.8.8`, `1.1.1.1`) before giving up.

Normal deployments with working system DNS are unaffected — no behavior change.

## 4. Authentication

- `POST /api/auth/register` — `{ name, subdomain, ownerEmail, password, salonType, location }`
  → `201 { token, companyId, subdomain }`. Subdomains are unique + lowercase, passwords
  bcrypt-hashed, JWT contains `companyId`.
- `POST /api/auth/login` — `{ subdomain, email, password }`
  → `200 { token, companyId, subdomain, name }`.
- `GET /api/auth/settings` — Bearer; returns a **public-safe subset** of the salon config
  (`name`, `subdomain`, `salonType`, `location`, `upiId`, `gstNo`, `language`,
  `whatsappEnabled`, `razorpayKey`, `logoUrl`, `whatsappConfigured`). The WhatsApp token is
  **never** returned — `whatsappConfigured` reflects the server env.
- `PUT /api/auth/settings` — Bearer; update salon config
  (`language`, `upiId`, `gstNo`, `whatsappEnabled`, `razorpayKey`, `logoUrl`, `location`, `salonType`).

Protected endpoints require `Authorization: Bearer <token>`. The verified `companyId`
from the JWT is used server-side for every company-owned resource — a caller-supplied
`companyId` is **never** trusted when a valid token is present (multi-tenant isolation).

## 5. API endpoints

### Services — `/api/services`
| Method | Path                  | Auth   | Notes                                              |
| ------ | --------------------- | ------ | -------------------------------------------------- |
| POST   | `/create`             | Bearer | multipart (`image`), fields: name, category, durationMins, price, gender, isCombo, comboServices |
| GET    | `/list`               | opt.   | `?companyId=&category=&gender=`; populates `comboServices` |
| GET    | `/public`             | none   | `?subdomain=mysalon` → `{ company, services }` (active only) |

### Staff — `/api/staff`
| Method | Path      | Auth   | Notes                                         |
| ------ | --------- | ------ | --------------------------------------------- |
| POST   | `/create` | Bearer | multipart (`photo`); name, phone, specialization, experienceYears, salary, commissionPercent, esslId |
| GET    | `/list`   | opt.   | `?companyId=&specialization=`                 |

### Bookings — `/api/bookings`
| Method | Path            | Auth   | Notes |
| ------ | --------------- | ------ | ----- |
| POST   | `/create`       | Bearer | Full booking flow (below) |
| POST   | `/public/create`| none   | Public booking; `companyId` in body |
| GET    | `/list`         | opt.   | `?companyId=&date=&staffId=&status=`; populates `serviceId`, `staffId`; sorted by slot |
| GET    | `/stats`        | opt.   | `?companyId=&date=` → `{ total, completed, noshow, revenue, noShowPercent, staffStats }` |
| POST   | `/status`       | Bearer | `{ bookingId, status, productsUsed }` — `completed` \| `no-show` \| `cancelled` |
| GET    | `/calendar`     | opt.   | `?companyId=&month=YYYY-MM` → `{ byDate, total }` |

Also aliased: `GET /api/calendar` (same handler).

**Booking creation logic (`create` + `public/create` are identical):**
1. Resolve service + staff (must belong to the salon; inactive staff rejected).
2. Offer validation when `offerCode`/`offerId` supplied — active, in validity window,
   usage remaining, minimum order met, applicable service.
3. Discount: `percent → total × value / 100` (capped by `maxDiscount`); `flat → value`.
4. `total = service.price − discount` (never negative).
5. `advancePaid = round(total × 0.20)` — always 20%.
6. **Slot conflict:** any non-cancelled booking with the same
   `companyId + staffId + bookingDate + slot` returns **`409 Conflict`** with
   `Slot already booked for this staff - {slot}`. A partial unique MongoDB index enforces
   the same rule even under a race.
7. Booking created (`status: booked`, `paymentStatus: pending`).
8. Offer `usedCount += 1` when applied.
9. Log line records the booking, staff, advance and the salon's UPI id.
10. WhatsApp confirmation (Marathi/Hindi/English per `company.language`) sent
    asynchronously — never blocks the response.

**Status transitions:**
- `completed`: creates the invoice, deducts product stock, computes GST (18%) and staff
  commission, generates `INV-YYYY-XXXXXX`.
- `no-show`: status set; the advance is retained.
- `cancelled`: status set; **releases the slot** so a new booking can take it.

**Stats:** `revenue` = sum of `total` over completed bookings for the day;
`noShowPercent = round(noshow / total × 100)` (safe at 0 bookings); `staffStats`
groups completed bookings by staff (`{ _id: staffName, count, revenue }`).

### Packages — `/api/packages`
| Method | Path      | Auth   | Notes |
| ------ | --------- | ------ | ----- |
| POST   | `/create` | Bearer | `{ name, services: [{serviceId, qty}], price, originalPrice, validityDays }` — `savings = originalPrice − price` computed automatically |
| GET    | `/list`   | opt.   | `?companyId=`; populates `services.serviceId` |
| GET    | `/public` | none   | `?subdomain=` → `{ company, packages }` (active only) |

### Offers — `/api/offers`
| Method | Path       | Auth   | Notes |
| ------ | ---------- | ------ | ----- |
| POST   | `/create`  | Bearer | `{ code, title, discountType (percent\|flat), discountValue, minOrderAmount, maxDiscount, usageLimit, validFrom, validUntil, applicableServices, applicablePackages }` |
| GET    | `/list`    | opt.   | `?companyId=&isActive=true` |
| POST   | `/validate`| opt.   | `{ code, serviceId, total }` → `{ valid: true, discount, offerId }`; validated against all rules |

Company for `/validate` comes from the JWT when present, otherwise from the `serviceId`.

### Memberships — `/api/memberships`
| Method | Path      | Auth   | Notes |
| ------ | --------- | ------ | ----- |
| POST   | `/create` | Bearer | `{ customerName, phone, packageId, startDate }` — `endDate = startDate + package.validityDays`, `servicesTotal = Σ qty` |
| GET    | `/list`   | opt.   | `?companyId=&phone=&status=active`; populates `packageId.services.serviceId` (service names) |
| POST   | `/use`    | Bearer | `{ membershipId, serviceId }` — verifies service in package, per-service qty not exhausted, membership active; expires when all services used |

### Products — `/api/products`
| Method | Path      | Auth   | Notes |
| ------ | --------- | ------ | ----- |
| POST   | `/create` | Bearer | multipart `images` array (max 5); name, brand, price, gstPercent, stock, minStock, category |
| GET    | `/list`   | opt.   | `?companyId=&lowStock=true` — `lowStock` returns `stock <= minStock` |

### Invoices — `/api/invoices`
| Method | Path       | Auth   | Notes |
| ------ | ---------- | ------ | ----- |
| GET    | `/list`    | opt.   | `?companyId=&date=YYYY-MM-DD` — newest first, max 100 |
| POST   | `/pay`     | Bearer | `{ invoiceId }` → `paymentStatus: paid` |
| GET    | `/pdf/:id` | opt.   | Generates the invoice PDF (PDFKit) with a UPI-payment QR code |

**Invoice math:** `total = Σ service prices + Σ product prices`;
`gstTotal = round(total × 0.18)`; `grandTotal = total + gstTotal − discount`;
`staffCommission = round(serviceTotal × staff.commissionPercent / 100)`.
Number format: `INV-{currentYear}-{last 6 digits of Date.now()}`.

### Attendance (eSSL) — `/api/attendance`
| Method | Path    | Auth | Notes |
| ------ | ------- | ---- | ----- |
| POST   | `/sync` | none | `{ esslId, inTime, outTime, date, companyId? }` — finds staff by `esslId` (scoped to `companyId` when supplied), upserts the daily record |
| GET    | `/list` | opt. | `?companyId=&date=` |

**Multi-tenant guard:** when no `companyId` is supplied and an `esslId` exists under more
than one salon, `/sync` returns `400` instead of guessing. When `companyId` is supplied
the lookup is scoped to that salon, so two salons can share the same device id safely.

### WhatsApp — `/api/whatsapp`
| Method | Path   | Auth   | Notes |
| ------ | ------ | ------ | ----- |
| POST   | `/send`| Bearer | `{ bookingId, type, language }` |
| POST   | `/test`| Bearer | `{ type, language }` → sample message text |

Message types: `confirmation`, `no-show`, `upsell`, `membership-expiry`, `invoice`.
Languages: `Marathi` (default), `Hindi`, `English`.

- **Confirmation**: customer, date, slot, service, staff, advance, UPI id, Google Maps link.
- **No-show**: customer + notice that the advance is retained.
- **Upsell**: `Add Spa for Rs 300 more? Reply YES`.
- **Membership expiry**: package name, end date, UPI id.
- **Invoice**: invoice number, grand total, UPI id, PDF download link.

Integration uses the Meta Cloud API via
`https://graph.facebook.com/v18.0/{WHATSAPP_PHONE_ID}/messages` with
`WHATSAPP_TOKEN` (server-side only — never exposed to the frontend). Without
credentials the sender prints the message to the log and returns `mocked: true`;
the booking flow is unaffected.

### Payments — `/api/payment`
| Method | Path           | Auth   | Notes |
| ------ | -------------- | ------ | ----- |
| POST   | `/create-order`| Bearer | `{ type: "booking"\|"invoice", bookingId?, invoiceId? }` → Razorpay order (amount in paise) |
| POST   | `/verify`      | none   | `{ razorpay_payment_id, razorpay_order_id, razorpay_signature, bookingId?, invoiceId? }` |

`/verify` checks the HMAC-SHA256 signature
(`createHmac("sha256", RAZORPAY_SECRET).update(orderId + "|" + paymentId)`) and marks
the booking advance / invoice as paid on success. Returns `503` when Razorpay is not
configured.

### Reviews — `/api/reviews`
| Method | Path      | Auth | Notes |
| ------ | --------- | ---- | ----- |
| POST   | `/create` | none | `{ bookingId, rating (1–5), comment }` |
| GET    | `/list`   | opt. | `?companyId=` → `{ reviews, average }` |

### Leads — `/api/leads`
| Method | Path     | Auth   | Notes |
| ------ | -------- | ------ | ----- |
| POST   | `/create`| none   | `{ companyId, name, phone, message, source = "public" }` |
| GET    | `/list`  | opt.   | `?companyId=` |
| POST   | `/status`| opt.   | `{ leadId, status }` — `new` \| `contacted` \| `closed` |

### Audit export — `/api/audit`
| Method | Path     | Auth | Notes |
| ------ | -------- | ---- | ----- |
| GET    | `/export`| opt. | `?companyId=&year=2026` |

Builds a multi-sheet Excel workbook (ExcelJS) — Audit, Bookings, Staff Commission,
Products, Memberships, Offers — saved under `public/exports/audit-{year}-{companyId}.xlsx`.
Response: `{ fileUrl: "/public/exports/audit-…xlsx", count }`.

## 6. Upload handling & static files

### User images (services / staff / products)

- Multer (disk storage), image files only (jpeg/png/webp/gif), max 5 MB, max 5
  files per product.
- Every upload is **verified by magic bytes** after Multer writes it, so a
  renamed script or an HTML/SVG polyglot is rejected whatever it claims its
  content type to be. The extension is derived from the detected type, never
  from the filename. Filenames are `Date.now()` + 8 random bytes.
- Files are stored **partitioned per tenant**: `uploads/<folder>/<companyId>/<file>`.
  Records store the matching relative URL, e.g.
  `/uploads/services/6ab67…/1756…-a1b2c3d4.png`, and the frontend resolves it
  through its `fileUrl()` helper. Both the directory and the stored URL are
  produced by the same `uploadDir()` / `uploadUrl()` helpers in
  `middleware/upload.js`, so they cannot drift apart.
- Served from `/uploads/*` → `backend/uploads/*` as **public static files**, with
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`.

  This has to stay public: the public booking page shows service images to
  anonymous visitors, and an `<img>` tag cannot carry a bearer token. So
  partitioning is defence in depth — it guarantees two salons can never collide
  on, overwrite or mis-attribute a file — not the access control. Making staff
  and product images private would mean proxying them through an authenticated
  route and fetching them as blobs. Do not add a plain static mount for any
  other directory.

### Generated documents (invoice PDFs, audit workbooks)

**There is deliberately no static mount for these.** They contain customer names,
phones and revenue, so they are written **outside** any publicly servable
directory and are served *only* through authenticated routes that call
`res.download()`:

| Document        | Written to                     | Served by                           |
| --------------- | ------------------------------ | ----------------------------------- |
| Invoice PDF     | `backend/exports/invoices/`    | `GET /api/invoices/pdf/:id`         |
| Audit workbook  | `backend/exports/audit/`       | `GET /api/audit/download?year=YYYY` |

The paths are fixed in code — `INVOICE_DIR` in `utils/pdf.js` and `EXPORT_DIR` in
`routes/audit.js` — both `path.join(__dirname, "..", "exports", …)`.

`GET /api/audit/export` returns `{ fileUrl: "/api/audit/download?year=YYYY", count }`
— an **API** path, not a static one. A request for `/exports/…` or
`/public/exports/…` returns 404 by design; the only static mount in the whole app
is `/uploads` (see above). The entire `exports/` tree is git-ignored.

> Note: a `backend/public/exports/` directory may exist on a machine that ran an
> older build, from before the export directories were moved out of `public/`.
> Nothing reads it and it should be deleted. If you ever find yourself adding
> `app.use("/public", express.static(…))` to "fix" a 404 on an export path, that
> is the bug — it would publish every customer's invoice and revenue.

## 7. Cron jobs (`cron.js` — auto-started by `app.js`, guarded against duplicate registration)

| Schedule            | Job                                                                 |
| ------------------- | ------------------------------------------------------------------- |
| **every 5 min** (`*/5 * * * *`) | Release stale booking-completion claims (`reapStaleCompletionClaims`) and expire abandoned payment orders (`expireStaleOrders`) so a wedged checkout cannot block a customer forever |
| **every 30 min** (`*/30 * * * *`) | No-show sweep — `booked` bookings on the last two days whose last occupied slot ended more than 60 minutes ago become `no-show` (advance retained). Claims each booking atomically, releases offer usage, retires any still-payable advance order, then sends the WhatsApp notice |
| 08:00 (`0 8 * * *`) | Reminder for **tomorrow's** bookings (Marathi + map) + membership expiry alerts (7 days out) + auto-expire overdue memberships |
| 09:00 (`0 9 * * *`) | Low-stock alert for `stock <= minStock` products                     |
| 09:15 (`15 9 * * *`) | Deactivate expired offers (`validUntil` passed) and offers whose `usedCount >= usageLimit` |

Timezone: `TZ` env (default `Asia/Kolkata`). Every job body is wrapped in
`try/catch`, so a failing job logs and returns rather than taking the process
down or aborting the remaining jobs in that tick.

Set `DISABLE_CRON=1` to start the API with all of these parked (useful for a
test harness or a maintenance window). It is **ignored, with a warning, when
`NODE_ENV=production`** — a production deployment whose sweeps silently never
run would be a correctness bug.

## 8. Deployment

Works on Render / Railway / any Node host:

1. Set the env vars listed in section 2. `JWT_SECRET`, `MONGO_URI` and
   `CORS_ORIGIN` are **required** when `NODE_ENV=production` — the server exits
   with a message naming each one that is missing rather than starting in a
   degraded state. List every browser origin that will call the API, including
   the public booking page's own domain.
2. Build the frontend with `NEXT_PUBLIC_API_URL=https://<your-backend-domain>/api`.
   The frontend build **fails** if that value is missing or points at
   `localhost`/`127.0.0.1`, because those names resolve on the visitor's device.
3. `uploads/` and `exports/` are created automatically on first use. The build
   host must have a writable disk for both. Neither may be exposed by the
   platform's static file serving: `/uploads` is served by the app itself, and
   `exports/` is served only over authenticated routes.
4. Health check for the platform: `GET /api/health` → `{ "ok": true }`. It does
   not touch the database, so use it for liveness and watch the startup log for
   `[db] connected to MongoDB` for readiness.
5. At boot the server logs which integrations are live and which are mocked
   (see §2). Treat a `[config] … are NOT configured` line as a deployment
   defect, not a notice, if you intended those features to work.

## 9. Testing

```bash
npm test
# or: node scripts/run-e2e.js
```

Boots an ephemeral MongoDB (`mongodb-memory-server`, one-time binary download), spawns
the real server, and runs the full flow over HTTP: auth, CRUD for every resource,
booking + **409 double-booking**, offer/membership/invoice math, stock deduction,
payments (signature verification), WhatsApp mock, attendance (incl. cross-salon eSSL
scoping), salon settings GET/PUT (secret-leak guard), reviews, leads, audit export,
calendar, public endpoints, multi-tenant isolation, and edge cases. Current suite:
**179 assertions**. Run `npm test` and look for `===== RESULTS: 179 passed, 0 failed =====`.

External integrations (Meta WhatsApp, Razorpay orders, eSSL devices) use safe mock /
latent paths when credentials or hardware are unavailable — nothing is faked as a
"real" external call in tests.