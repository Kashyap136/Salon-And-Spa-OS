# AGENTS.md

"Salon & Spa OS" monorepo: a Next.js 14 (App Router) frontend in `Frontend/` and an Express + MongoDB REST API in `backend/`. Work inside one of these directories; never create files at the repo root. Note: git still tracks the old root-level file paths (the `Frontend/` move isn't committed yet), so trust the `Frontend/` tree over `git ls-files`.

## Frontend

```bash
cd Frontend
npm install
cp .env.example .env.local   # no .env.local exists by default
npm run dev                  # http://localhost:3000
npm run build                # primary verification (README: clean, 15 routes)
npm run lint                 # next lint — ESLint configured (.eslintrc.json → next/core-web-vitals)
```

No frontend tests and no CI. `npm run build` is the sanity check. The app needs the backend at `NEXT_PUBLIC_API_URL` (default `http://localhost:5005/api`), now served by `backend/` in this repo.

## Architecture

- Frontend: every page is a client component (`"use client"`), fetches server-side nothing; all data comes from the backend over axios, loaded in `useEffect`. `app/layout.jsx` is the only server component.
- Single axios instance in `lib/api.js` (`@/lib/api`, aliased via `jsconfig.json` `@/*` → repo root). It auto-attaches `Authorization: Bearer <token>` from localStorage and on any 401 clears the session and redirects to `/`. Treat 401s as handled globally — do not add per-page auth guards.
- Session lives in localStorage keys `token`, `companyId`, `subdomain`, `companyName`. Read/write only through `getSession()` / `setSession()` / `clearSession()`. Pages pull `companyId` via `getSession()` and pass it as a query param on each call.
- Image paths returned by the API (e.g. `/uploads/...`) must go through `fileUrl()` — never string-concat `NEXT_PUBLIC_API_URL` yourself.
- Component helpers are `components/Navbar.jsx`, `components/StatCard.jsx`, `components/StatusBadge.jsx`. `StatusBadge` centralizes status styling/labels; add new statuses to its `MAP` instead of styling inline.
- Pages not yet built (per README): `/attendance`, `/reviews`, `/leads` — the backend routes exist and are tested; only the frontend pages are pending. The public page's inquiry form already posts to `/leads/create`.
- Every data-fetch `load(...)` helper is wrapped in `useCallback` and driven through `useEffect` with the callback in deps — keep that pattern when adding fetches (avoids `exhaustive-deps` noise).

## Backend

```bash
cd backend
npm install
cp .env.example .env.local   # MONGO_URI, JWT_SECRET, RAZORPAY_*, WHATSAPP_* (see backend/README.md)
npm start                    # http://localhost:5005/api
npm test                     # e2e suite (73 assertions) — ephemeral MongoDB via mongodb-memory-server
```

- Express + Mongoose, single-tenant-per-company isolation via `req.companyId` from the JWT (never trusts a caller-supplied `companyId` when a token is present). Port 5005, default `MONGO_URI=mongodb://localhost:27017/salon_spa_os`.
- Atlas SRV DNS resilience: on a connect failure matching `querySrv|ECONNREFUSED|ENOTFOUND|EAI_AGAIN` the server retries once with public resolvers (`8.8.8.8,1.1.1.1`) unless `DNS_SERVERS` env pins the resolver. Keep `mongodb+srv://` URIs — never rewrite them to non-SRV forms.
- `backend/README.md` documents every endpoint, request body, business rule (20% advance, 409 slot conflicts, 18% GST, `INV-YYYY-XXXXXX` invoices, offer caps, membership expiry, staff commission) and the cron jobs — keep it in sync when touching API behavior.
- Testing without MongoDB installed: `npm test` spawns `mongodb-memory-server` (binary auto-downloads on first run) and exercises the real server over HTTP — never fake the external calls (Meta WhatsApp, Razorpay orders) as real.
- External integrations degrade gracefully with mock/latent paths when credentials are absent — the app never crashes for missing env config.

## Design system — "Reception Ledger"

- Reuse the existing theme instead of inventing styles. Tokens: `ledger.*` / `status.*` colors in `tailwind.config.js`; fonts `font-display` (Cormorant Garamond) / `font-body` (Manrope) loaded via `next/font` in layout.
- Shared CSS classes in `app/globals.css`: `ledger-panel`, `ledger-rule`, `ledger-table`, `gold-line`, `btn-gold`, `btn-ghost`, `pill`. No card shadows anywhere (deliberate).
- Some colors are referenced as inline hex (e.g. `#7FC79A` green / `#E08076` red) — matching existing pages is fine.

## Business/API quirks (hardcoded in the client)

- Booking slots are generated client-side in `bookings/page.jsx` and `public/[subdomain]/page.jsx` (`buildSlots()`): 09:00–19:30, 30-min increments.
- Advance is always 20% of `(service price − offer discount)`, rounded. Slots/advance appear duplicated across both pages.
- Offer validation: `POST /offers/validate`. Slot conflict surfaces as HTTP 409 — shown to the user verbatim.
- WhatsApp sending: `POST /whatsapp/send` with `language` hardcoded to `"Marathi"` in the bookings page. The Settings page does real `GET/PUT /auth/settings` (safe subset — the WhatsApp API token lives only in server env, never stored or returned). SMS/UPI/WhatsApp keys are pretended via `/settings` env fields.
- Memberships list nested-populates `packageId.services.serviceId` so the UI can render a "redeem service" name dropdown (no raw ObjectId prompts).
- Public booking page (`/public/[subdomain]`) calls `POST /bookings/public/create` — implemented in `backend/` (no Bearer check, `companyId` from the body). Don't wire the public page through the authed path.
- Bookings status flow: `booked` → `complete` (auto-invoices) / `no-show`. `next.config.js` uses CommonJS `module.exports`; keep it that way.
- The README's "Backend contract notes" section is current and worth reading.