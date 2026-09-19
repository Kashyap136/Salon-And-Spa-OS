# Salon & Spa OS — Frontend

Next.js 14 (App Router) + Tailwind frontend for the Salon & Spa OS dev sheet.
Build verified clean (`npm run build`, 14/14 routes compile with zero errors).

## Design system — "Reception Ledger"

A salon runs on a physical appointment diary at the front desk — the UI leans
into that instead of a generic light SaaS dashboard: a wine-leather backdrop,
gold-foil accents, ledger-style ruled tables (no card shadows), Cormorant
Garamond for headers and Manrope for data/body text. Tokens live in
`tailwind.config.js` (`ledger.*` / `status.*` colors) and `app/globals.css`.

## Run it

```bash
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_URL at your backend
npm run dev                  # http://localhost:3000
```

## Pages built (matches the dev sheet's Section 5 one-for-one)

| Route | Covers |
|---|---|
| `/` | Login + register (subdomain-based) |
| `/dashboard` | Today's stats, staff performance, low stock, memberships expiring |
| `/services` | Service CRUD, image upload, category/gender filters, combo flag |
| `/staff` | Staff CRUD, photo upload, commission %, eSSL ID |
| `/bookings` | **Core flow** — slot picker, offer validation, 409 slot-conflict handling, advance calc, status actions (complete → auto-invoice, no-show, WA send) |
| `/packages` | Bridal/Groom/Spa Day bundles, auto savings calc |
| `/offers` | Coupon CRUD, valid/expired status |
| `/memberships` | Validity, used/total redemption, expiring-soon badge, "use service" |
| `/products` | Retail inventory, low-stock badge |
| `/calendar` | Month view with green/yellow/amber/red booking-density dots |
| `/invoices` | INV-YYYY-XXXXXX list, mark paid, WhatsApp + UPI resend |
| `/settings` | Language, UPI, WhatsApp/Razorpay keys, WA test-message buttons |
| `/public/[subdomain]` | No-auth public booking page — services, packages, offers, staff, booking form with live advance calc + UPI deep link, inquiry form |

## Backend contract notes

- Every authenticated call sends `Authorization: Bearer <token>` automatically
  (see `lib/api.js`) — nothing to wire up per-page.
- A 401 anywhere clears the session and bounces to `/`.
- The public booking page calls `POST /api/bookings/public/create`. The dev
  sheet flags this as a route your team still needs to add (same logic as
  `/bookings/create`, minus the Bearer check) — it's not yet in Section 4's
  route list, so add it before the public page goes live.
- `fileUrl()` in `lib/api.js` resolves `/uploads/...` paths returned by the
  API against `NEXT_PUBLIC_API_URL`'s origin — no per-page string concatenation.

## Not yet built

Attendance (eSSL sync), Reviews, and Leads list pages aren't included — the
dev sheet lists their APIs as "Next Steps for Dev Team" (Section 10, items
4 and 6–7), not as committed frontend pages in Section 5. The public page's
inquiry form already posts to `/leads/create`. Happy to add dedicated
`/attendance`, `/reviews`, and `/leads` pages once those routes exist.
