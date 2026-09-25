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

See `.env.example` for the full list:

| Variable            | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `PORT`              | Server port (default `5005`)                               |
| `MONGO_URI`         | MongoDB connection string (local or Atlas)                 |
| `MONGO_DB`          | Optional database name override                            |
| `DNS_SERVERS`       | Optional — comma-separated resolvers to pin Node's DNS (see §3) |
| `JWT_SECRET`        | Secret used to sign auth tokens                            |
| `RAZORPAY_KEY`      | Razorpay key id                                            |
| `RAZORPAY_SECRET`   | Razorpay key secret (payment signature verification)       |
| `WHATSAPP_TOKEN`    | Meta Cloud API bearer token                                |
| `WHATSAPP_PHONE_ID` | Meta WhatsApp phone number id                              |
| `UPI_ID`            | UPI id used in booking confirmations / invoice QR codes    |
| `TZ`                | Cron timezone (default `Asia/Kolkata`)                     |
| `ALERT_TO`          | Low-stock alert recipient (reserved)                       |

No real credentials are committed. The backend falls back to a **mock WhatsApp
mode** and guarded errors when credentials are absent — the app never crashes for
missing external configuration.

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

- Multer (disk storage), image files only (jpeg/png/webp/gif), max 5 MB.
- Documents store relative URLs, e.g. `/uploads/services/xxx.png` — the frontend
  resolves these through its `fileUrl()` helper.
- Served from: `/uploads/*` → `backend/uploads/*` and `/public/*` → `backend/public/*`.

## 7. Cron jobs (`cron.js` — auto-started by `app.js`, guarded against duplicate registration)

| Schedule            | Job                                                                 |
| ------------------- | ------------------------------------------------------------------- |
| 08:00               | Reminder for **tomorrow's** bookings (Marathi + map) + membership expiry alerts (7 days out) + auto-expire overdue memberships |
| 18:00               | No-show check — today's `booked` slots whose end time passed become `no-show` (advance retained); WhatsApp notice sent |
| 09:00 (daily)       | Low-stock alert for `stock <= minStock` products                     |
| 09:15 (daily)       | Deactivate expired offers (`validUntil` passed) and offers whose `usedCount >= usageLimit` |

Timezone: `TZ` env (default `Asia/Kolkata`).

## 8. Deployment

Works on Render / Railway / any Node host:

1. Set the env vars listed in section 2 (startup runs `npm start` → `node app.js`).
2. The frontend points at `NEXT_PUBLIC_API_URL=https://<your-backend-domain>/api`.
3. Static `/uploads` and `/public` folders are created automatically on first use.

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
**73 assertions**. Run `npm test` and look for `===== RESULTS: 73 passed, 0 failed =====`.

External integrations (Meta WhatsApp, Razorpay orders, eSSL devices) use safe mock /
latent paths when credentials or hardware are unavailable — nothing is faked as a
"real" external call in tests.