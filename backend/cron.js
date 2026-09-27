/**
 * Scheduled jobs (node-cron). Automatically started by app.js when the
 * backend boots. Guarded so jobs register exactly once per process.
 */
const cron = require("node-cron");
const Booking = require("./models/Booking");
const Membership = require("./models/Membership");
const Product = require("./models/Product");
const Offer = require("./models/Offer");
const Company = require("./models/Company");
const Staff = require("./models/Staff");
const Service = require("./models/Service");
const Package = require("./models/Package");
const { ymdInTimezone } = require("./utils/helpers");
const { slotEndsBeforeNow } = require("./utils/slots");
const { releaseOfferUsage } = require("./utils/offers");
const { reapStaleCompletionClaims } = require("./utils/invoicing");
// expireLiveOrders retires the ONE open advance order for a specific booking or
// invoice; expireStaleOrders sweeps abandoned orders on a timer. Both are needed:
// when the no-show sweep claims a booking it must void a still-payable advance
// order immediately, or the customer can pay for an appointment that no longer
// exists. This call was missing from the destructuring, so evaluating it threw
// ReferenceError on the first booking of every tick and aborted the whole sweep.
const { expireLiveOrders, expireStaleOrders } = require("./routes/payment");
const { buildMessage, sendWhatsAppMessage, mapLink, upiIdFor } = require("./utils/whatsapp");

const TZ = process.env.TZ || "Asia/Kolkata";

if (!global.__CRON_STARTED__) {
  global.__CRON_STARTED__ = true;

  // One query per page instead of one per row. Each loop below used to
  // `await Company.findById(row.companyId)` inside the for-loop, which is an
  // N+1: a 200-row page cost 200 extra round trips, and the no-show sweep
  // repeats that every 30 minutes. A company that no longer exists is simply
  // absent from the Map, so the skip-if-gone guard is unchanged.
  async function companiesFor(rows) {
    const ids = [...new Set(rows.map((r) => r.companyId).filter(Boolean))];
    if (ids.length === 0) return new Map();
    // No projection: buildMessage reads company.location (via mapLink) and
    // company.upiId (via upiIdFor), and a stale field list here silently
    // drops the map link out of every reminder. Company is a small one-doc-
    // per-tenant collection, so fetching them whole is the safe, cheap choice.
    const found = await Company.find({ _id: { $in: ids } })
      .lean();
    return new Map(found.map((c) => [String(c._id), c]));
  }

  async function sendTo(company, phone, text) {
    if (!text || !company || !company.whatsappEnabled) return;
    try {
      await sendWhatsAppMessage({ to: phone, text });
    } catch (err) {
      const masked = String(phone || "").replace(/\D/g, "").slice(-4);
      console.error(`[cron] WhatsApp send failed (…${masked}):`, err.message);
    }
  }

  // 8:00 AM — tomorrow's booking reminders (Marathi + map) and expiry alerts.
  cron.schedule(
    "0 8 * * *",
    async () => {
      // The schedule below fires at 08:00 in TZ, so "tomorrow" must be computed
      // in TZ too. localYMD() would use the host's timezone and, on a UTC
      // container, silently remind the wrong calendar day.
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const dateStr = ymdInTimezone(tomorrow, TZ);

      try {
        // Bounded page: a salon with a very large book tomorrow would otherwise
        // load every row (and two populated relations each) into memory in one
        // tick. Paged on _id, and each page is processed before the next is read.
        const PAGE = 200;
        let cursor = null;
        let queued = 0;

        do {
          const bookings = await Booking.find({
            bookingDate: dateStr,
            status: "booked",
            ...(cursor ? { _id: { $gt: cursor } } : {}),
          })
            .select(
              "_id companyId phone customerName bookingDate slot advancePaid serviceId staffId"
            )
            .sort({ _id: 1 })
            .limit(PAGE)
            .lean();

          if (bookings.length === 0) break;
          cursor = bookings[bookings.length - 1]._id;

          // Projections are limited to the fields the message needs, and the
          // match pins them to the booking's own tenant so a corrupt
          // cross-tenant reference cannot put another salon's staff/service name
          // in a customer message.
          const serviceIds = [...new Set(bookings.map((b) => b.serviceId).filter(Boolean))];
          const staffIds = [...new Set(bookings.map((b) => b.staffId).filter(Boolean))];
          const serviceNames = new Map(
            (await Service.find({
              _id: { $in: serviceIds },
              companyId: { $in: [...new Set(bookings.map((b) => String(b.companyId)))] },
            })
              .select("_id name companyId")
              .lean()
          ).map((s) => [`${s.companyId}:${s._id}`, s.name])
          );
          const staffNames = new Map(
            (await Staff.find({
              _id: { $in: staffIds },
              companyId: { $in: [...new Set(bookings.map((b) => String(b.companyId)))] },
            })
              .select("_id name companyId")
              .lean()
          ).map((s) => [`${s.companyId}:${s._id}`, s.name])
          );

          const companies = await companiesFor(bookings);
          for (const booking of bookings) {
            const company = companies.get(String(booking.companyId)) || null;
            if (!company) continue;
            const text = buildMessage(
              "confirmation",
              {
                customerName: booking.customerName,
                salonName: company.name || "Salon & Spa OS",
                bookingDate: booking.bookingDate,
                slot: booking.slot,
                serviceName: serviceNames.get(`${booking.companyId}:${booking.serviceId}`) || "—",
                staffName: staffNames.get(`${booking.companyId}:${booking.staffId}`) || "—",
                advance: booking.advancePaid,
                upiId: upiIdFor(company),
                map: mapLink(company),
              },
              company.language
            );
            await sendTo(company, booking.phone, text);
            queued++;
          }
        } while (true);

        console.log(`[cron] 8AM: ${queued} tomorrow reminders queued`);
      } catch (err) {
        console.error("[cron] tomorrow reminder failed:", err.message);
      }

      try {
        // Memberships expiring within 7 days + auto-expire overdue ones.
        const now = new Date();
        const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const PAGE = 200;
        let cursor = null;
        let alerted = 0;

        do {
          const expiring = await Membership.find({
            status: "active",
            endDate: { $gte: now, $lte: in7 },
            ...(cursor ? { _id: { $gt: cursor } } : {}),
          })
            .select("_id companyId phone customerName endDate packageId")
            .sort({ _id: 1 })
            .limit(PAGE)
            .lean();

          if (expiring.length === 0) break;
          cursor = expiring[expiring.length - 1]._id;

          const packageIds = [...new Set(expiring.map((m) => m.packageId).filter(Boolean))];
          const packageNames = new Map(
            (await Package.find({
              _id: { $in: packageIds },
              companyId: { $in: [...new Set(expiring.map((m) => String(m.companyId)))] },
            })
              .select("_id name companyId")
              .lean()
          ).map((p) => [`${p.companyId}:${p._id}`, p.name])
          );

          const companies = await companiesFor(expiring);
          for (const m of expiring) {
            const company = companies.get(String(m.companyId)) || null;
            if (!company) continue;
            const text = buildMessage(
              "membership-expiry",
              {
                customerName: m.customerName,
                packageName: packageNames.get(`${m.companyId}:${m.packageId}`) || "Package",
                endDate: m.endDate ? ymdInTimezone(new Date(m.endDate), TZ) : "—",
                upiId: upiIdFor(company),
                salonName: company.name || "Salon & Spa OS",
              },
              company.language
            );
            await sendTo(company, m.phone, text);
            alerted++;
          }
        } while (true);

        await Membership.updateMany(
          { status: "active", endDate: { $lt: now } },
          { status: "expired" }
        );
        console.log(`[cron] 8AM: ${alerted} membership expiry alerts`);
      } catch (err) {
        console.error("[cron] membership expiry failed:", err.message);
      }
    },
    { timezone: TZ }
  );

  // No-show sweep, every 30 minutes all day.
  //
  // This used to run ONCE at 18:00. The grace period is 60 minutes, so a slot
  // ending at 18:30 (and every later slot — the salon takes bookings until
  // 19:30) was still inside its grace window at 18:00 and got skipped. It was
  // then never reconsidered, because the next day's run queries a new date: those
  // appointments stayed `booked` forever, still showing as upcoming.
  //
  // Running repeatedly makes it self-healing: the `slotEndsBeforeNow` check is a
  // no-op until a slot's grace elapses, and the transition itself is claimed on
  // `status: "booked"`, so repeated passes are idempotent. The 2-day lookback
  // additionally recovers appointments missed because the process was down at
  // 18:00.
  async function sweepNoShows() {
    try {
      // Bounded: at most two days of bookings, read in ID-ordered pages.
      const today = ymdInTimezone(new Date(), TZ);
      const twoDaysAgo = ymdInTimezone(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), TZ);
      const PAGE = 200;
      let cursor = null;
      let marked = 0;
      let scanned = 0;

      do {
        const bookings = await Booking.find({
          bookingDate: { $gte: twoDaysAgo, $lte: today },
          status: "booked",
          ...(cursor ? { _id: { $gt: cursor } } : {}),
        })
          .select(
            "_id companyId phone offerId slot occupiedSlots advancePaid bookingDate customerName"
          )
          .sort({ _id: 1 })
          .limit(PAGE)
          .lean();

        if (bookings.length === 0) break;
        cursor = bookings[bookings.length - 1]._id;
        scanned += bookings.length;

        const companies = await companiesFor(bookings);
        for (const booking of bookings) {
          // Judge the service by its LAST occupied window (a 90-minute treatment
          // is still running), and only after a 60-minute grace period.
          const lastSlot =
            (booking.occupiedSlots && booking.occupiedSlots.length
              ? booking.occupiedSlots[booking.occupiedSlots.length - 1]
              : booking.slot) || booking.slot;
          if (!slotEndsBeforeNow(lastSlot, new Date(), 60, TZ)) continue;

          // Claim the transition atomically: if reception completed or cancelled
          // this booking since the query, the status is no longer "booked" and
          // we must not overwrite it (nor message the customer about it).
          const claimed = await Booking.findOneAndUpdate(
            { _id: booking._id, companyId: booking.companyId, status: "booked" },
            { $set: { status: "no-show" } },
            { new: true }
          );
          if (!claimed) continue;
          marked++;

          // A no-show is not a redemption. Without this, one missed appointment
          // permanently consumes a capped coupon.
          if (booking.offerId) {
            await releaseOfferUsage(booking.companyId, booking.offerId).catch((e) =>
              console.error("[cron] offer release failed:", e.message)
            );
          }

          // The appointment is gone; an open advance order must not be payable.
          await expireLiveOrders(
            booking.companyId,
            "booking",
            booking._id,
            "marked no-show by cron"
          ).catch((e) => console.error("[cron] payment-order expiry failed:", e.message));

            const company = companies.get(String(booking.companyId)) || null;
          if (!company) continue;
          const text = buildMessage(
            "no-show",
            {
              customerName: booking.customerName,
              bookingDate: booking.bookingDate,
              slot: booking.slot,
              advance: booking.advancePaid,
              salonName: company.name || "Salon & Spa OS",
            },
            company.language
          );
          await sendTo(company, booking.phone, text);
        }
      } while (true);

      if (marked) {
        console.log(`[cron] no-show sweep: ${marked} of ${scanned} booking(s) marked no-show (advance retained)`);
      }
    } catch (err) {
      console.error("[cron] no-show check failed:", err.message);
    }
  }

  cron.schedule("*/30 * * * *", sweepNoShows, { timezone: TZ });

  // 9:00 AM — daily low-stock alert.
  cron.schedule(
    "0 9 * * *",
    async () => {
      try {
        // Streamed rather than loaded whole: a catalogue-wide low-stock query
        // returns one row per product and the alert is only a console summary.
        // A hard ceiling keeps a pathological dataset from filling the heap; the
        // truncation is reported rather than silent.
        const CAP = 500;
        const low = await Product.find({ $expr: { $lte: ["$stock", "$minStock"] } })
          .select("name stock")
          .sort({ stock: 1 })
          .limit(CAP + 1)
          .lean();
        if (low.length) {
          const shown = low.slice(0, CAP);
          const suffix = low.length > CAP ? ` …and more (showing first ${CAP})` : "";
          console.log(
            `[cron] low-stock alert (${low.length}${low.length > CAP ? "+" : ""}): ${shown
              .map((p) => `${p.name} (${p.stock} left)`)
              .join(", ")}${suffix}`
          );
        } else {
          console.log("[cron] low-stock check: all stocked");
        }
      } catch (err) {
        console.error("[cron] low-stock check failed:", err.message);
      }
    },
    { timezone: TZ }
  );

  // 9:15 AM — daily offer expiry + membership expiry cleanup.
  cron.schedule(
    "15 9 * * *",
    async () => {
      try {
        const now = new Date();
        const res = await Offer.updateMany(
          { isActive: true, $or: [{ validUntil: { $lt: now } }, { usageLimit: { $gt: 0 }, $expr: { $gte: ["$usedCount", "$usageLimit"] } }] },
          { isActive: false }
        );
        console.log(`[cron] offer expiry check: ${res.modifiedCount} offers deactivated`);
      } catch (err) {
        console.error("[cron] offer expiry check failed:", err.message);
      }
    },
    { timezone: TZ }
  );

  // Every 5 minutes — release completion claims whose process died.
  //
  // `completeBooking()` already compensates failures it can see, so this only
  // reaps a booking left in the internal "completing" state by a crash or an OOM
  // kill. Without it such a booking was permanently wedged: every status
  // transition is filtered on status: "booked", so reception could neither
  // complete (invoice), cancel (release the slot) nor mark it no-show.
  //
  // The same tick retires abandoned Razorpay orders. A real order left in
  // `created` holds the one-live-order slot for that booking/invoice forever,
  // so a customer who once opened checkout could never try again.
  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        await reapStaleCompletionClaims();
      } catch (err) {
        console.error("[cron] stale completion reaper failed:", err.message);
      }
      try {
        await expireStaleOrders();
      } catch (err) {
        console.error("[cron] abandoned payment-order reaper failed:", err.message);
      }
    },
    { timezone: TZ }
  );

  console.log("[cron] scheduled jobs registered");
}