const express = require("express");
const Booking = require("../models/Booking");
const Invoice = require("../models/Invoice");
const Membership = require("../models/Membership");
const { authRequired } = require("../middleware/auth");
const { isValidObjectId, AppError } = require("../utils/helpers");
const { buildMessage, sendWhatsAppMessage, mapLink, upiIdFor } = require("../utils/whatsapp");
const { generateInvoicePdf } = require("../utils/pdf");

const router = express.Router();

const TYPES = ["confirmation", "no-show", "upsell", "membership-expiry", "invoice"];

function contextFor({ booking, invoice, membership }) {
  const service = booking && booking.serviceId;
  const staff = booking && booking.staffId;
  return {
    customerName: booking ? booking.customerName : "Test Customer",
    bookingDate: booking ? booking.bookingDate : "2026-05-13",
    slot: booking ? booking.slot : "10:00-10:30",
    serviceName: service && service.name ? service.name : "Hair Cut",
    staffName: staff && staff.name ? staff.name : "Stylist",
    advance: booking ? booking.advancePaid : 200,
    invoiceNo: invoice ? invoice.invoiceNo : "INV-2026-000001",
    grandTotal: invoice ? invoice.grandTotal : 1200,
    packageName: membership && membership.packageId ? membership.packageId.name : "Spa Package",
    endDate: membership ? new Date(membership.endDate).toLocaleDateString("en-IN") : "2026-12-31",
  };
}

// POST /api/whatsapp/send — { bookingId, type, language }
router.post("/send", authRequired, async (req, res, next) => {
  try {
    const { bookingId, type, language } = req.body;
    if (!TYPES.includes(type)) throw new AppError(400, `type must be one of ${TYPES.join(", ")}`);
    if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");

    const booking = await Booking.findOne({ _id: bookingId, companyId: req.companyId })
      .populate("serviceId")
      .populate("staffId");
    if (!booking) throw new AppError(404, "Booking not found");

    const company = req.company;
    let invoice = null;
    let membership = null;

    if (type === "invoice") {
      invoice = await Invoice.findOne({ bookingId: booking._id }).sort({ createdAt: -1 });
      if (invoice) {
        const pdf = await generateInvoicePdf({ company, invoice }).catch(() => null);
        if (pdf) invoice.pdfUrl = pdf.url;
      }
    }
    if (type === "membership-expiry") {
      membership = await Membership.findOne({
        companyId: req.companyId,
        phone: booking.phone,
        status: "active",
      }).populate("packageId");
    }

    const data = {
      ...contextFor({ booking, invoice, membership }),
      salonName: company.name || "Salon & Spa OS",
      upiId: upiIdFor(company),
      map: mapLink(company),
      pdfUrl: invoice ? invoice.pdfUrl || "" : "",
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
      ...contextFor({ booking: null, invoice: null, membership: null }),
      salonName: req.company ? req.company.name : "Salon & Spa OS",
      upiId: req.company ? upiIdFor(req.company) : process.env.UPI_ID || "salon@upi",
      map: mapLink(req.company || null),
      pdfUrl: "",
    };

    const text = buildMessage(type, data, language);
    res.json({ msg: text, message: text, mocked: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;