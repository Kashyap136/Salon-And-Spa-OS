const express = require("express");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const Staff = require("../models/Staff");
const Company = require("../models/Company");
const Offer = require("../models/Offer");
const { authRequired, authOptional } = require("../middleware/auth");
const { completeBooking } = require("../utils/invoicing");
const { calendarHandler } = require("../utils/calendar");
const { SLOTS, isValidSlot } = require("../utils/slots");
const {
  AppError,
  isValidObjectId,
  toBool,
  isYMD,
  effectiveCompany,
} = require("../utils/helpers");
const { buildMessage, sendWhatsAppMessage, mapLink, upiIdFor } = require("../utils/whatsapp");

const router = express.Router();

const PAYMENT_MODES = ["UPI", "Cash", "Razorpay"];

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
  if (!isValidObjectId(serviceId)) throw new AppError(400, "Invalid serviceId");
  if (!isValidObjectId(staffId)) throw new AppError(400, "Invalid staffId");
  if (!isYMD(bookingDate)) throw new AppError(400, "bookingDate must be in YYYY-MM-DD format");
  if (!isValidSlot(slot)) {
    throw new AppError(400, "Invalid slot. Slots are 30-minute windows from 09:00 to 20:00");
  }
  if (!PAYMENT_MODES.includes(paymentMode)) throw new AppError(400, "Invalid payment mode");

  const [service, staff] = await Promise.all([
    Service.findOne({ _id: serviceId, companyId }),
    Staff.findOne({ _id: staffId, companyId }),
  ]);
  if (!service) throw new AppError(404, "Service not found for this salon");
  if (!staff) throw new AppError(404, "Staff not found for this salon");
  if (staff.status === "inactive") throw new AppError(400, "This staff member is not active");

  // Offer validation + discount.
  let total = service.price || 0;
  let discount = 0;
  let appliedOfferId = null;

  const code = String(offerCode || "").trim().toUpperCase();
  if (code || isValidObjectId(offerId)) {
    const offer = code
      ? await Offer.findOne({ companyId, code })
      : await Offer.findById(offerId);
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

    if (offer.discountType === "percent") {
      discount = Math.round((total * offer.discountValue) / 100);
      if (offer.maxDiscount > 0 && discount > offer.maxDiscount) discount = offer.maxDiscount;
    } else {
      discount = offer.discountValue;
    }
    appliedOfferId = offer._id;
  }

  const totalAfterDiscount = Math.max(total - discount, 0);
  const advancePaid = Math.round(totalAfterDiscount * 0.2);

  // Double-booking guard (application level) — cancelled bookings don't block.
  const conflict = await Booking.findOne({
    companyId,
    staffId,
    bookingDate,
    slot,
    status: { $ne: "cancelled" },
  });
  if (conflict) {
    throw new AppError(409, `Slot already booked for this staff - ${slot}`);
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
      bookingDate,
      slot,
      advancePaid,
      advancePercent: 20,
      total: totalAfterDiscount,
      paymentMode,
      paymentStatus: "pending",
      status: "booked",
      isPackage: toBool(isPackage),
      packageId: isPackage && isValidObjectId(packageId) ? packageId : null,
      offerId: appliedOfferId,
      discountApplied: discount,
    });
  } catch (err) {
    // Unique index race — same slot grabbed between check and insert.
    if (err && err.code === 11000) {
      throw new AppError(409, `Slot already booked for this staff - ${slot}`);
    }
    throw err;
  }

  if (appliedOfferId) {
    await Offer.updateOne({ _id: appliedOfferId }, { $inc: { usedCount: 1 } });
  }

  const companyIdStr = companyId.toString ? companyId.toString() : String(companyId);
  const company = await Company.findById(companyIdStr).catch(() => null);

  // Step 9 — log the booking.
  console.log(
    `[booking] id=${booking._id} customer=${booking.customerName} phone=${booking.phone} ` +
      `date=${booking.bookingDate} slot=${booking.slot} staff=${staff.name} ` +
      `advance=₹${advancePaid} upi=${upiIdFor(company)}`
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
router.post("/public/create", async (req, res, next) => {
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

// GET /api/bookings/list?companyId=&date=&staffId=&status=
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const filter = { companyId };
    if (req.query.date) filter.bookingDate = req.query.date;
    if (req.query.staffId) filter.staffId = req.query.staffId;
    if (req.query.status) filter.status = req.query.status;

    const bookings = await Booking.find(filter)
      .populate("serviceId")
      .populate("staffId")
      .sort({ slot: 1 });
    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/stats?companyId=&date=
router.get("/stats", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) {
      return res.json({ total: 0, completed: 0, noshow: 0, revenue: 0, noShowPercent: 0, staffStats: [] });
    }

    const match = { companyId };
    if (req.query.date) match.bookingDate = req.query.date;

    const dayBookings = await Booking.find(match);
    const total = dayBookings.length;
    const completed = dayBookings.filter((b) => b.status === "completed").length;
    const noshow = dayBookings.filter((b) => b.status === "no-show").length;
    const revenue = dayBookings
      .filter((b) => b.status === "completed")
      .reduce((sum, b) => sum + (b.total || 0), 0);
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

// POST /api/bookings/status — { bookingId, status, productsUsed }
router.post("/status", authRequired, async (req, res, next) => {
  try {
    const { bookingId, status, productsUsed } = req.body;
    if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");
    if (!["completed", "no-show", "cancelled"].includes(status)) {
      throw new AppError(400, "Status must be completed, no-show or cancelled");
    }

    const booking = await Booking.findOne({ _id: bookingId, companyId: req.companyId })
      .populate("serviceId")
      .populate("staffId");
    if (!booking) throw new AppError(404, "Booking not found");

    if (status === "completed") {
      const invoice = await completeBooking(booking, req.companyId, productsUsed);
      return res.json({ msg: "Booking completed and invoice generated", bookingId: booking._id, invoiceId: invoice._id });
    }

    if (status === "no-show") {
      booking.status = "no-show";
      await booking.save();
      // The advance is kept; nothing else to change.
      return res.json({ msg: "Marked as no-show — advance retained", booking });
    }

    // cancelled — frees the staff/date/slot so a new booking can take it.
    booking.status = "cancelled";
    await booking.save();
    return res.json({ msg: "Booking cancelled — slot released", booking });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/calendar?companyId=&month=YYYY-MM
router.get("/calendar", calendarHandler);

module.exports = router;
module.exports.calendarHandler = calendarHandler;
module.exports.createBookingCore = createBookingCore;
module.exports.sendBookingConfirmation = sendBookingConfirmation;