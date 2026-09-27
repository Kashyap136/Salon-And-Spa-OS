const express = require("express");
const Booking = require("../models/Booking");
const Invoice = require("../models/Invoice");
const Membership = require("../models/Membership");
const { authRequired } = require("../middleware/auth");
const { isValidObjectId, AppError } = require("../utils/helpers");
const { buildMessage, sendWhatsAppMessage, mapLink, upiIdFor } = require("../utils/whatsapp");

const router = express.Router();

const TYPES = ["confirmation", "no-show", "upsell", "membership-expiry", "invoice"];

/**
 * Placeholder values used ONLY by /test, which is explicitly a preview that
 * sends nothing. /send must never fall back to these: a customer receiving
 * "INV-2026-000001 — ₹1200" for a booking with no invoice is being told a
 * fabricated amount, which is a billing/consumer-protection problem, not a
 * cosmetic one. /send throws instead (see the checks below).
 */
const TEST_ONLY_CONTEXT = {
  customerName: "Test Customer",
  bookingDate: "2026-05-13",
  slot: "10:00-10:30",
  serviceName: "Hair Cut",
  staffName: "Stylist",
  advance: 200,
  invoiceNo: "INV-2026-000001",
  grandTotal: 1200,
  packageName: "Spa Package",
  endDate: "2026-12-31",
};

/**
 * Context for a real send.
 *
 * Only the relations the chosen message type actually needs are read; `/send`
 * has already refused to proceed when a required one is missing, so nothing
 * here ever substitutes a placeholder. Types that do not use a relation simply
 * get `undefined` for those keys.
 */
function contextFor({ booking, invoice, membership }) {
  const service = booking && booking.serviceId;
  const staff = booking && booking.staffId;
  return {
    customerName: booking.customerName,
    bookingDate: booking.bookingDate,
    slot: booking.slot,
    serviceName: service && service.name ? service.name : "Service",
    staffName: staff && staff.name ? staff.name : "Stylist",
    advance: booking.advancePaid,
    ...(invoice
      ? { invoiceNo: invoice.invoiceNo, grandTotal: invoice.grandTotal }
      : {}),
    ...(membership
      ? {
          packageName: membership.packageId ? membership.packageId.name : "Membership",
          endDate: new Date(membership.endDate).toLocaleDateString("en-IN"),
        }
      : {}),
  };
}

// POST /api/whatsapp/send — { bookingId, type, language }
router.post("/send", authRequired, async (req, res, next) => {
  try {
    const { bookingId, type, language } = req.body;
    if (!TYPES.includes(type)) throw new AppError(400, `type must be one of ${TYPES.join(", ")}`);
    if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");

    const booking = await Booking.findOne({ _id: bookingId, companyId: req.companyId })
      .populate({ path: "serviceId", match: { companyId: req.companyId } })
      .populate({ path: "staffId", match: { companyId: req.companyId } });
    if (!booking) throw new AppError(404, "Booking not found");

    const company = req.company;
    let invoice = null;
    let membership = null;

    if (type === "invoice") {
      invoice = await Invoice.findOne({ companyId: req.companyId, bookingId: booking._id }).sort({
        createdAt: -1,
      });
      // Never message a customer a fabricated invoice number and amount. The
      // booking simply has not been completed (or was completed by another
      // path) — tell the operator instead of sending a made-up bill.
      if (!invoice) {
        throw new AppError(
          409,
          "This booking has no invoice yet — complete the booking before sending an invoice message"
        );
      }
    }
    if (type === "membership-expiry") {
      membership = await Membership.findOne({
        companyId: req.companyId,
        phone: booking.phone,
        status: "active",
      })
        .populate({ path: "packageId", match: { companyId: req.companyId } });
      if (!membership) {
        throw new AppError(
          409,
          "No active membership was found for this customer's phone number"
        );
      }
    }

    const data = {
      ...contextFor({ booking, invoice, membership }),
      salonName: company.name || "Salon & Spa OS",
      upiId: upiIdFor(company),
      map: mapLink(company),
    };

    const text = buildMessage(type, data, language);
    if (!text) throw new AppError(400, "Unsupported message type");

    const result = await sendWhatsAppMessage({ to: booking.phone, text });

    res.json({ message: text, msg: text, mocked: result.mocked });
  } catch (err) {
    next(err);
  }
});

// POST /api/whatsapp/test — { language, type } — returns the message without sending.
router.post("/test", authRequired, async (req, res, next) => {
  try {
    const { language, type } = req.body;
    if (!TYPES.includes(type)) throw new AppError(400, `type must be one of ${TYPES.join(", ")}`);

    const data = {
      ...TEST_ONLY_CONTEXT,
      salonName: req.company ? req.company.name : "Salon & Spa OS",
      upiId: req.company ? upiIdFor(req.company) : process.env.UPI_ID || "salon@upi",
      map: mapLink(req.company || null),
    };

    const text = buildMessage(type, data, language);
    res.json({ msg: text, message: text, mocked: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;