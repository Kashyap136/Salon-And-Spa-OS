const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const Booking = require("../models/Booking");
const Invoice = require("../models/Invoice");
const { authRequired } = require("../middleware/auth");
const { isValidObjectId, AppError } = require("../utils/helpers");

const router = express.Router();

function razorpayInstance() {
  if (!process.env.RAZORPAY_KEY || !process.env.RAZORPAY_SECRET) return null;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY,
    key_secret: process.env.RAZORPAY_SECRET,
  });
}

/**
 * POST /api/payment/create-order — { type: "booking"|"invoice", bookingId?, invoiceId? }
 * Creates a Razorpay order (amount in paise).
 */
router.post("/create-order", authRequired, async (req, res, next) => {
  try {
    const rp = razorpayInstance();
    if (!rp) throw new AppError(503, "Razorpay is not configured on this server");

    const { type, bookingId, invoiceId } = req.body;
    if (!["booking", "invoice"].includes(type)) throw new AppError(400, "type must be booking or invoice");

    let amount = 0;
    let receipt = "";

    if (type === "booking") {
      if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");
      const booking = await Booking.findOne({ _id: bookingId, companyId: req.companyId });
      if (!booking) throw new AppError(404, "Booking not found");
      amount = Math.round(booking.advancePaid || 0) * 100;
      receipt = `adv_${booking._id}`.slice(0, 40);
    } else {
      if (!isValidObjectId(invoiceId)) throw new AppError(400, "Invalid invoice id");
      const invoice = await Invoice.findOne({ _id: invoiceId, companyId: req.companyId });
      if (!invoice) throw new AppError(404, "Invoice not found");
      amount = Math.round(invoice.grandTotal || 0) * 100;
      receipt = `inv_${invoice._id}`.slice(0, 40);
    }

    if (amount <= 0) throw new AppError(400, "Amount must be greater than zero");

    const order = await rp.orders.create({ amount, currency: "INR", receipt });
    res.json({ order, key: process.env.RAZORPAY_KEY });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payment/verify
 * Body: { razorpay_payment_id, razorpay_order_id, razorpay_signature, bookingId?, invoiceId? }
 * Verifies the HMAC-SHA256 signature and marks payment paid.
 */
router.post("/verify", async (req, res, next) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, bookingId, invoiceId } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      throw new AppError(400, "razorpay_payment_id, razorpay_order_id and razorpay_signature are required");
    }
    if (!process.env.RAZORPAY_SECRET) {
      throw new AppError(503, "Razorpay is not configured on this server");
    }

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      throw new AppError(400, "Invalid payment signature");
    }

    let updated = 0;
    if (isValidObjectId(bookingId)) {
      const booking = await Booking.findOne({ _id: bookingId });
      if (booking && booking.paymentStatus !== "paid") {
        booking.paymentStatus = "paid";
        await booking.save();
        updated++;
      }
    }
    if (isValidObjectId(invoiceId)) {
      const invoice = await Invoice.findOne({ _id: invoiceId });
      if (invoice && invoice.paymentStatus !== "paid") {
        invoice.paymentStatus = "paid";
        await invoice.save();
        updated++;
      }
    }

    res.json({ msg: "Payment verified", updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;