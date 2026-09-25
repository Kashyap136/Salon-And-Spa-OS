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
const { localYMD } = require("./utils/helpers");
const { slotEndsBeforeNow } = require("./utils/slots");
const { buildMessage, sendWhatsAppMessage, mapLink, upiIdFor } = require("./utils/whatsapp");

const TZ = process.env.TZ || "Asia/Kolkata";

if (!global.__CRON_STARTED__) {
  global.__CRON_STARTED__ = true;

  async function sendTo(company, phone, text) {
    if (!text || !company || !company.whatsappEnabled) return;
    try {
      await sendWhatsAppMessage({ to: phone, text });
    } catch (err) {
      console.error(`[cron] WhatsApp send failed (${phone}):`, err.message);
    }
  }

  // 8:00 AM — tomorrow's booking reminders (Marathi + map) and expiry alerts.
  cron.schedule(
    "0 8 * * *",
    async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = localYMD(tomorrow);

      try {
        const bookings = await Booking.find({
          bookingDate: dateStr,
          status: "booked",
        }).populate("serviceId").populate("staffId");

        for (const booking of bookings) {
          const company = await Company.findById(booking.companyId).catch(() => null);
          if (!company) continue;
          const text = buildMessage(
            "confirmation",
            {
              customerName: booking.customerName,
              salonName: company.name || "Salon & Spa OS",
              bookingDate: booking.bookingDate,
              slot: booking.slot,
              serviceName: booking.serviceId ? booking.serviceId.name : "—",
              staffName: booking.staffId ? booking.staffId.name : "—",
              advance: booking.advancePaid,
              upiId: upiIdFor(company),
              map: mapLink(company),
            },
            company.language
          );
          await sendTo(company, booking.phone, text);
        }
        console.log(`[cron] 8AM: ${bookings.length} tomorrow reminders queued`);
      } catch (err) {
        console.error("[cron] tomorrow reminder failed:", err.message);
      }

      try {
        // Memberships expiring within 7 days + auto-expire overdue ones.
        const now = new Date();
        const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const expiring = await Membership.find({
          status: "active",
          endDate: { $gte: now, $lte: in7 },
        }).populate("packageId");

        for (const m of expiring) {
          const company = await Company.findById(m.companyId).catch(() => null);
          if (!company) continue;
          const text = buildMessage(
            "membership-expiry",
            {
              customerName: m.customerName,
              packageName: m.packageId ? m.packageId.name : "Package",
              endDate: m.endDate.toISOString().slice(0, 10),
              upiId: upiIdFor(company),
              salonName: company.name || "Salon & Spa OS",
            },
            company.language
          );
          await sendTo(company, m.phone, text);
        }

        await Membership.updateMany(
          { status: "active", endDate: { $lt: now } },
          { status: "expired" }
        );
        console.log(`[cron] 8AM: ${expiring.length} membership expiry alerts`);
      } catch (err) {
        console.error("[cron] membership expiry failed:", err.message);
      }
    },
    { timezone: TZ }
  );

  // 6:00 PM — no-show check for today's ended slots.
  cron.schedule(
    "0 18 * * *",
    async () => {
      try {
        const dateStr = localYMD();
        const bookings = await Booking.find({
          bookingDate: dateStr,
          status: "booked",
        }).populate("serviceId").populate("staffId");

        let marked = 0;
        for (const booking of bookings) {
          if (!slotEndsBeforeNow(booking.slot)) continue; // slot still in the future
          booking.status = "no-show";
          await booking.save();
          marked++;

          const company = await Company.findById(booking.companyId).catch(() => null);
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
        console.log(`[cron] 6PM: ${marked} bookings marked no-show (advance retained)`);
      } catch (err) {
        console.error("[cron] no-show check failed:", err.message);
      }
    },
    { timezone: TZ }
  );

  // 9:00 AM — daily low-stock alert.
  cron.schedule(
    "0 9 * * *",
    async () => {
      try {
        const low = await Product.find({ $expr: { $lte: ["$stock", "$minStock"] } });
        if (low.length) {
          console.log(
            `[cron] low-stock alert (${low.length}): ${low
              .map((p) => `${p.name} (${p.stock} left)`)
              .join(", ")}`
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

  console.log("[cron] scheduled jobs registered");
}