const express = require("express");
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const Staff = require("../models/Staff");
const Company = require("../models/Company");
const Offer = require("../models/Offer");
const Package = require("../models/Package");
const { authRequired } = require("../middleware/auth");
const { completeBooking } = require("../utils/invoicing");
const { releaseOfferUsage } = require("../utils/offers");
const { expireLiveOrders } = require("./payment");
const { calendarHandler } = require("../utils/calendar");
const { SLOTS, isValidSlot, occupiedSlotsFor } = require("../utils/slots");
const {
  AppError,
  isValidObjectId,
  toBool,
  toNumber,
  isRealDate,
  isPastYMD,
  effectiveCompany,
  round2,
} = require("../utils/helpers");
const { buildMessage, sendWhatsAppMessage, mapLink, upiIdFor } = require("../utils/whatsapp");
const { rateLimit } = require("../utils/rateLimit");

const router = express.Router();

const PAYMENT_MODES = ["UPI", "Cash", "Razorpay"];

// Anonymous booking requests are bounded per IP: the public page is open to
// anyone, so slot-holding spam must not be possible.
const publicBookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40 });

/**
 * Core booking logic shared by the authenticated and the public endpoints.
 * Returns { booking } or throws AppError.
 */
async function createBookingCore({ companyId, body }) {
  const {
    customerName,
    phone,
    email = "",
    serviceId,
    staffId,
    bookingDate,
    slot,
    paymentMode = "UPI",
    offerCode,
    offerId,
    isPackage = false,
    packageId,
  } = body;

  if (!customerName || !phone) throw new AppError(400, "customerName and phone are required");
  if (String(customerName).length > 120 || String(phone).length > 32) {
    throw new AppError(400, "customerName or phone is too long");
  }
  if (!isValidObjectId(serviceId)) throw new AppError(400, "Invalid serviceId");
  if (!isValidObjectId(staffId)) throw new AppError(400, "Invalid staffId");
  if (!isRealDate(bookingDate)) {
    throw new AppError(400, "bookingDate must be a real date in YYYY-MM-DD format");
  }
  if (isPastYMD(bookingDate)) throw new AppError(400, "bookingDate cannot be in the past");
  if (!isValidSlot(slot)) {
    throw new AppError(400, "Invalid slot. Slots are 30-minute windows from 09:00 to 20:00");
  }
  if (!PAYMENT_MODES.includes(paymentMode)) throw new AppError(400, "Invalid payment mode");

  const [service, staff] = await Promise.all([
    Service.findOne({ _id: serviceId, companyId }),
    Staff.findOne({ _id: staffId, companyId }),
  ]);
  if (!service) throw new AppError(404, "Service not found for this salon");
  if (!service.isActive) throw new AppError(400, "This service is no longer available");
  if (!staff) throw new AppError(404, "Staff not found for this salon");
  if (staff.status === "inactive") throw new AppError(400, "This staff member is not active");

  // Package bookings must reference an active package of this salon that
  // actually contains the selected service.
  const wantsPackage = toBool(isPackage);
  let validPackageId = null;
  if (wantsPackage) {
    if (!isValidObjectId(packageId)) throw new AppError(400, "packageId is required for a package booking");
    const pkg = await Package.findOne({ _id: packageId, companyId });
    if (!pkg) throw new AppError(404, "Package not found for this salon");
    if (!pkg.isActive) throw new AppError(400, "This package is no longer available");
    const contains = (pkg.services || []).some(
      (s) => String(s.serviceId) === String(serviceId)
    );
    if (!contains) {
      throw new AppError(400, "This service is not part of the selected package");
    }
    validPackageId = packageId;
  }

  // Every 30-minute window this service occupies (duration-aware overlap).
  let occupiedSlots;
  try {
    occupiedSlots = occupiedSlotsFor(slot, service.durationMins);
  } catch (err) {
    throw new AppError(400, err.message);
  }

  // Offer validation + discount.
  const total = round2(service.price || 0);
  let discount = 0;
  let appliedOfferId = null;
  let offerDoc = null;

  const code = String(offerCode || "").trim().toUpperCase();
  if (code || isValidObjectId(offerId)) {
    const offer = code
      ? await Offer.findOne({ companyId, code })
      : await Offer.findOne({ _id: offerId, companyId });
    if (!offer) throw new AppError(400, "Invalid offer code");

    const now = new Date();
    if (!offer.isActive) throw new AppError(400, "This offer is no longer active");
    if (offer.validFrom && new Date(offer.validFrom) > now) throw new AppError(400, "This offer is not valid yet");
    if (offer.validUntil && new Date(offer.validUntil) < now) throw new AppError(400, "This offer has expired");
    if (offer.usageLimit > 0 && offer.usedCount >= offer.usageLimit) {
      throw new AppError(400, "This offer is fully used");
    }
    if (offer.minOrderAmount > 0 && total < offer.minOrderAmount) {
      throw new AppError(400, `Minimum order for this offer is ₹${offer.minOrderAmount}`);
    }
    if (
      offer.applicableServices &&
      offer.applicableServices.length > 0 &&
      !offer.applicableServices.map(String).includes(String(serviceId))
    ) {
      throw new AppError(400, "This offer is not applicable to the selected service");
    }
    if (
      offer.applicablePackages &&
      offer.applicablePackages.length > 0 &&
      !wantsPackage
    ) {
      throw new AppError(400, "This offer is only valid on package bookings");
    }
    if (
      offer.applicablePackages &&
      offer.applicablePackages.length > 0 &&
      !offer.applicablePackages.map(String).includes(String(validPackageId))
    ) {
      throw new AppError(400, "This offer is not applicable to the selected package");
    }

    if (offer.discountType === "percent") {
      discount = round2((total * offer.discountValue) / 100);
      if (offer.maxDiscount > 0 && discount > offer.maxDiscount) discount = offer.maxDiscount;
    } else {
      discount = round2(offer.discountValue);
    }
    // A discount can never exceed the amount being discounted.
    discount = Math.min(Math.max(discount, 0), total);
    appliedOfferId = offer._id;
    offerDoc = offer;
  }

  const totalAfterDiscount = round2(Math.max(total - discount, 0));
  const advancePaid = Math.round(totalAfterDiscount * 0.2);

  // Double-booking guard (application level, best-effort; the unique multikey
  // index on occupiedSlots is the authoritative backstop). Cancelled bookings
  // (activeSlot=false) do not block.
  const conflict = await Booking.findOne({
    companyId,
    staffId,
    bookingDate,
    activeSlot: true,
    occupiedSlots: { $in: occupiedSlots },
  });
  if (conflict) {
    throw new AppError(409, `Slot already booked for this staff - ${slot}`);
  }

  // Reserve the offer atomically: the usage limit is re-checked at write time
  // so concurrent bookings cannot jointly exceed it. Rolled back on failure.
  if (offerDoc) {
    const filter = { _id: offerDoc._id, companyId: offerDoc.companyId };
    if (offerDoc.usageLimit > 0) {
      filter.$expr = { $lt: ["$usedCount", "$usageLimit"] };
    }
    const reserved = await Offer.findOneAndUpdate(filter, { $inc: { usedCount: 1 } }, { new: true });
    if (!reserved) throw new AppError(400, "This offer is fully used");
    offerDoc = reserved;
  }

  let booking;
  try {
    booking = await Booking.create({
      companyId,
      customerName: String(customerName).trim(),
      phone,
      email,
      serviceId,
      staffId,
      serviceName: service.name,
      servicePrice: total,
      serviceDurationMins: service.durationMins || 30,
      bookingDate,
      slot,
      occupiedSlots,
      activeSlot: true,
      advancePaid,
      advancePercent: 20,
      total: totalAfterDiscount,
      paymentMode,
      paymentStatus: "pending",
      status: "booked",
      isPackage: wantsPackage,
      packageId: validPackageId,
      offerId: appliedOfferId,
      discountApplied: discount,
    });
  } catch (err) {
    if (offerDoc) {
      // Compensate the reservation. A failure here is logged (not swallowed)
      // because it means the offer counter is now one ahead of real usage.
      await releaseOfferUsage(companyId, offerDoc._id).catch((rollbackErr) => {
        console.error(
          `[booking] failed to roll back offer usage for ${offerDoc._id}:`,
          rollbackErr.message
        );
      });
    }
    // Unique index race — same slot grabbed between check and insert.
    if (err && err.code === 11000) {
      throw new AppError(409, `Slot already booked for this staff - ${slot}`);
    }
    throw err;
  }

  const companyIdStr = companyId.toString ? companyId.toString() : String(companyId);
  const company = await Company.findById(companyIdStr).catch(() => null);

  // Step 9 — log the booking (no customer PII in logs).
  console.log(
    `[booking] id=${booking._id} date=${booking.bookingDate} slot=${booking.slot} ` +
      `staff=${staff.name} advance=₹${advancePaid} upi=${upiIdFor(company)}`
  );

  // Step 10 — WhatsApp confirmation (async, never blocks the response).
  if (company && company.whatsappEnabled) {
    sendBookingConfirmation({ booking, service, staff, company }).catch((err) => {
      console.error("WhatsApp confirmation failed:", err.message);
    });
  }

  return { booking };
}

async function sendBookingConfirmation({ booking, service, staff, company }) {
  const lang = company.language || "Marathi";
  const text = buildMessage("confirmation", {
    customerName: booking.customerName,
    salonName: company.name || "Salon & Spa OS",
    bookingDate: booking.bookingDate,
    slot: booking.slot,
    serviceName: service ? service.name : "—",
    staffName: staff ? staff.name : "—",
    advance: booking.advancePaid,
    upiId: upiIdFor(company),
    map: mapLink(company),
  }, lang);
  if (text) await sendWhatsAppMessage({ to: booking.phone, text });
}

// POST /api/bookings/create — authenticated.
router.post("/create", authRequired, async (req, res, next) => {
  try {
    const { booking } = await createBookingCore({ companyId: req.companyId, body: req.body });
    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

// POST /api/bookings/public/create — no auth (public booking page).
// The company is resolved from the request body; the same slot logic applies.
router.post("/public/create", publicBookingLimiter, async (req, res, next) => {
  try {
    const companyId = req.body.companyId;
    if (!isValidObjectId(companyId)) throw new AppError(400, "Invalid companyId");
    const company = await Company.findById(companyId);
    if (!company) throw new AppError(404, "Salon not found");

    const { booking } = await createBookingCore({ companyId, body: req.body });
    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/list?date=&staffId=&status= — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const filter = { companyId: req.companyId };
    if (req.query.date) {
      if (!isRealDate(req.query.date)) {
        throw new AppError(400, "date must be a real date in YYYY-MM-DD format");
      }
      filter.bookingDate = req.query.date;
    }
    if (req.query.staffId) {
      if (!isValidObjectId(req.query.staffId)) throw new AppError(400, "Invalid staffId");
      filter.staffId = req.query.staffId;
    }
    if (req.query.status) {
      if (!["booked", "completing", "completed", "no-show", "cancelled"].includes(req.query.status)) {
        throw new AppError(400, "Invalid status filter");
      }
      filter.status = req.query.status;
    }

    const limit = Math.min(Math.max(toNumber(req.query.limit) || 200, 1), 500);
    const bookings = await Booking.find(filter)
      // `match` pins each populated relation to this tenant: a corrupt or
      // legacy cross-tenant serviceId/staffId reference then resolves to null
      // instead of rendering another salon's staff name and commission.
      .populate({ path: "serviceId", match: { companyId: req.companyId } })
      .populate({ path: "staffId", match: { companyId: req.companyId } })
      .sort({ slot: 1 })
      .limit(limit);
    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/stats?date= — authenticated, company-scoped.
// Aggregated in the database: loading every matching booking into Node would
// make a busy day (or an unbounded date range) a memory hazard.
router.get("/stats", authRequired, async (req, res, next) => {
  try {
    // Aggregation pipelines are NOT cast by Mongoose, so the tenant id has to be
    // a real ObjectId here — a plain string matches nothing and silently reports
    // zeroes.
    const match = { companyId: new mongoose.Types.ObjectId(String(req.companyId)) };
    if (req.query.date) {
      if (!isRealDate(req.query.date)) {
        throw new AppError(400, "date must be a real date in YYYY-MM-DD format");
      }
      match.bookingDate = req.query.date;
    }

    const [summary] = await Booking.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          noshow: { $sum: { $cond: [{ $eq: ["$status", "no-show"] }, 1, 0] } },
          revenue: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, { $ifNull: ["$total", 0] }, 0] },
          },
        },
      },
    ]);

    const total = summary ? summary.total : 0;
    const completed = summary ? summary.completed : 0;
    const noshow = summary ? summary.noshow : 0;
    const revenue = summary ? summary.revenue : 0;
    const noShowPercent = total > 0 ? Math.round((noshow / total) * 100) : 0;

    const staffRows = await Booking.aggregate([
      { $match: { ...match, status: "completed" } },
      { $group: { _id: "$staffId", count: { $sum: 1 }, revenue: { $sum: "$total" } } },
      { $lookup: { from: "staffs", localField: "_id", foreignField: "_id", as: "staff" } },
    ]);
    const staffStats = staffRows.map((s) => ({
      _id: (s.staff && s.staff[0] && s.staff[0].name) || s._id.toString(),
      count: s.count,
      revenue: s.revenue,
    }));

    res.json({ total, completed, noshow, revenue, noShowPercent, staffStats });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bookings/status — { bookingId, status, productsUsed }
 *
 * Transitions are guarded so a booking can only move out of "booked":
 *   - completed → invoiced exactly once (idempotent, safe to retry)
 *   - no-show   → advance retained
 *   - cancelled → frees the staff/date/slot (activeSlot=false)
 */
router.post("/status", authRequired, async (req, res, next) => {
  try {
    const { bookingId, status, productsUsed } = req.body;
    if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");
    if (!["completed", "no-show", "cancelled"].includes(status)) {
      throw new AppError(400, "Status must be completed, no-show or cancelled");
    }

    const booking = await Booking.findOne({ _id: bookingId, companyId: req.companyId })
      .populate({ path: "serviceId", match: { companyId: req.companyId } })
      .populate({ path: "staffId", match: { companyId: req.companyId } });
    if (!booking) throw new AppError(404, "Booking not found");

    if (status === "completed") {
      // completeBooking claims the transition atomically and is idempotent:
      // a retry returns the existing invoice without double-charging stock.
      const invoice = await completeBooking(booking, req.companyId, productsUsed);
      return res.json({ msg: "Booking completed and invoice generated", bookingId: booking._id, invoiceId: invoice._id });
    }

    if (status === "no-show") {
      const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, companyId: req.companyId, status: "booked" },
        { $set: { status: "no-show" } },
        { new: true }
      );
      if (!updated) throw new AppError(409, `Booking is already ${booking.status} and cannot be marked no-show`);
      // A no-show never redeemed the coupon, so give the use back. Without this
      // one missed appointment permanently burns a capped promotion.
      await releaseOfferUsage(req.companyId, updated.offerId).catch((e) =>
        console.error(`[booking] offer release failed for ${updated.offerId}:`, e.message)
      );
      // Retire any live advance order: the appointment will not happen, so the
      // customer must not be able to pay for it after the fact.
      const expired = await expireLiveOrders(
        req.companyId,
        "booking",
        updated._id,
        "booking marked no-show"
      ).catch((e) => {
        console.error(`[booking] payment-order expiry failed for ${updated._id}:`, e.message);
        return 0;
      });
      if (expired) {
        console.log(`[booking] retired ${expired} open payment order(s) after no-show of ${updated._id}`);
      }
      return res.json({
        msg: "Marked as no-show — advance retained",
        booking: updated,
        paymentOrdersExpired: expired,
      });
    }

    // cancelled — frees the staff/date/slot so a new booking can take it.
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, companyId: req.companyId, status: "booked" },
      { $set: { status: "cancelled", activeSlot: false } },
      { new: true }
    );
    if (!updated) throw new AppError(409, `Booking is already ${booking.status} and cannot be cancelled`);
    await releaseOfferUsage(req.companyId, updated.offerId).catch((e) =>
      console.error(`[booking] offer release failed for ${updated.offerId}:`, e.message)
    );
    // Retire any live advance order. Leaving it open meant the customer could
    // cancel, rebook the freed slot, and still settle the original order —
    // charging real money against an appointment that no longer exists.
    const expired = await expireLiveOrders(
      req.companyId,
      "booking",
      updated._id,
      "booking cancelled"
    ).catch((e) => {
      console.error(`[booking] payment-order expiry failed for ${updated._id}:`, e.message);
      return 0;
    });
    if (expired) {
      console.log(`[booking] retired ${expired} open payment order(s) after cancelling ${updated._id}`);
    }
    return res.json({
      msg: "Booking cancelled — slot released",
      booking: updated,
      paymentOrdersExpired: expired,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/calendar?month=YYYY-MM — authenticated, company-scoped.
router.get("/calendar", authRequired, calendarHandler);

module.exports = router;
module.exports.calendarHandler = calendarHandler;
module.exports.createBookingCore = createBookingCore;
module.exports.sendBookingConfirmation = sendBookingConfirmation;
