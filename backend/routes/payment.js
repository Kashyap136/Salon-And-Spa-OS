const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const Booking = require("../models/Booking");
const Invoice = require("../models/Invoice");
const PaymentOrder = require("../models/PaymentOrder");
const { authRequired } = require("../middleware/auth");
const { isValidObjectId, AppError, round2 } = require("../utils/helpers");

const router = express.Router();

/**
 * A reservation placeholder older than this is assumed to belong to a request
 * that died between the local insert and the Razorpay call. It stops holding the
 * customer's one-live-order slot.
 */
const RESERVATION_TTL_MINUTES = 10;

/**
 * Razorpay auto-cancels an unpaid order after 24h, so the local row is marked
 * `expired` at the same time. Without this, a customer who opened checkout and
 * walked away could never raise a new order for that record: the partial unique
 * index counts any `created` row as live, forever.
 */
const ORDER_TTL_HOURS = 24;

/**
 * Release live payment orders for a resource by transitioning them out of
 * `created`. Used when a booking is cancelled or marked no-show: an order left
 * live there could still be paid, and the money would be attached to an
 * appointment that will not happen.
 *
 * Returns the ids of the orders that were expired so the caller can log them.
 */
async function expireLiveOrders(companyId, type, resourceId, reason) {
  const res = await PaymentOrder.updateMany(
    { companyId, type, resourceId, status: "created" },
    {
      $set: {
        status: "expired",
        failureReason: `${reason} at ${new Date().toISOString()}`,
      },
    }
  );
  return res.modifiedCount;
}

/**
 * A real Razorpay client, or null when the deployment has no credentials.
 * Razorpay checkout is an optional integration in this product; booking and
 * invoice payments can also be settled by UPI/cash, so a missing key degrades
 * the feature instead of failing every request.
 */
function razorpayInstance() {
  if (!process.env.RAZORPAY_KEY || !process.env.RAZORPAY_SECRET) return null;
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY,
    key_secret: process.env.RAZORPAY_SECRET,
  });
}

/**
 * Resolve the payable amount for a booking advance or an invoice balance.
 * Scoped to the authenticated company so a caller can never price an order
 * against another tenant's record.
 */
async function resolvePayable(companyId, type, bookingId, invoiceId) {
  if (type === "booking") {
    if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");
    const booking = await Booking.findOne({ _id: bookingId, companyId });
    if (!booking) throw new AppError(404, "Booking not found");
    // Only an appointment that is still live can collect an advance. Ordering
    // one for a cancelled or missed appointment charges real money for a slot
    // the salon will not honour.
    if (booking.status !== "booked") {
      throw new AppError(
        409,
        `This booking is ${booking.status} — an advance can only be paid while it is booked`
      );
    }
    if (booking.paymentStatus === "paid") {
      throw new AppError(409, "This booking advance is already paid");
    }
    const amountPaise = Math.round((Number(booking.advancePaid) || 0) * 100);
    return { resourceId: booking._id, amountPaise, receipt: `adv_${booking._id}`.slice(0, 40) };
  }

  if (!isValidObjectId(invoiceId)) throw new AppError(400, "Invalid invoice id");
  const invoice = await Invoice.findOne({ _id: invoiceId, companyId });
  if (!invoice) throw new AppError(404, "Invoice not found");
  if (invoice.paymentStatus === "paid") {
    throw new AppError(409, "This invoice is already paid");
  }

  // Charge the BALANCE. grandTotal is the full amount owed; the 20% advance was
  // already collected at booking time. Raising an order for grandTotal charged
  // the customer twice for the same money — a systematic 20% overcharge on
  // every Razorpay booking.
  const grandTotal = round2(Number(invoice.grandTotal) || 0);
  const advancePaid = round2(Number(invoice.advancePaid) || 0);
  const balance = round2(Math.max(grandTotal - advancePaid, 0));
  const amountPaise = Math.round(balance * 100);
  return { resourceId: invoice._id, amountPaise, receipt: `inv_${invoice._id}`.slice(0, 40) };
}

/**
 * Claim the single live-order slot for a resource by inserting a placeholder
 * row. The unique partial index on (companyId, type, resourceId) where
 * status === "created" is what actually arbitrates; the application-level
 * pre-check below only exists to produce a friendlier 409 message.
 *
 * Returns the placeholder document. The caller must either promote it (setting
 * the real razorpayOrderId) or release it.
 */
async function reserveOrderSlot(companyId, type, resourceId, amountPaise) {
  // Clear reservations abandoned by a crashed request, otherwise a customer who
  // hit a network error would never be able to retry. Real (already-promoted)
  // orders are NOT deleted here — they are transitioned to `expired` by
  // expireStaleOrders() so the audit trail survives.
  await PaymentOrder.deleteMany({
    companyId,
    type,
    resourceId,
    status: "created",
    razorpayOrderId: /^pending:/,
    createdAt: { $lte: new Date(Date.now() - RESERVATION_TTL_MINUTES * 60 * 1000) },
  }).catch((err) => console.error("[payment] stale reservation cleanup failed:", err.message));

  const existing = await PaymentOrder.findOne({ companyId, type, resourceId, status: "created" });
  if (existing) {
    throw new AppError(
      409,
      `An unpaid payment order already exists for this ${type} (${existing.razorpayOrderId})`
    );
  }

  const placeholder = `pending:${crypto.randomUUID()}`;
  try {
    return await PaymentOrder.create({
      companyId,
      type,
      resourceId,
      amountPaise,
      currency: "INR",
      razorpayOrderId: placeholder,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      // Lost the race against a concurrent create-order for the same resource.
      throw new AppError(409, `An unpaid payment order already exists for this ${type}`);
    }
    throw err;
  }
}

/**
 * POST /api/payment/create-order — { type: "booking"|"invoice", bookingId?, invoiceId? }
 * Creates a Razorpay order and persists it locally, bound to company + resource
 * + amount, so that /verify can be anchored to a real, company-scoped order.
 */
router.post("/create-order", authRequired, async (req, res, next) => {
  let reservation = null;
  try {
    const { type, bookingId, invoiceId } = req.body;
    if (!["booking", "invoice"].includes(type)) {
      throw new AppError(400, "type must be booking or invoice");
    }

    const { resourceId, amountPaise, receipt } = await resolvePayable(
      req.companyId,
      type,
      bookingId,
      invoiceId
    );

    if (amountPaise <= 0) {
      throw new AppError(400, "There is nothing left to pay for this record");
    }

    // Read-only pre-check for the live-order rule, BEFORE the credentials check.
    // "You already have an unpaid order" is the more actionable answer than "this
    // server has no Razorpay credentials", and putting it after meant the rule
    // was invisible on any deployment that had not finished configuring
    // Razorpay. reserveOrderSlot() below is still the authoritative arbiter.
    const existing = await PaymentOrder.findOne({
      companyId: req.companyId,
      type,
      resourceId,
      status: "created",
    });
    if (existing) {
      throw new AppError(
        409,
        `An unpaid payment order already exists for this ${type} (${existing.razorpayOrderId})`
      );
    }

    const rp = razorpayInstance();
    if (!rp) throw new AppError(503, "Razorpay is not configured on this server");

    // Claim the one-live-order slot BEFORE the network call, so a failure here
    // cannot leave a real Razorpay order with no local row to verify against.
    reservation = await reserveOrderSlot(req.companyId, type, resourceId, amountPaise);

    let order;
    try {
      order = await rp.orders.create({ amount: amountPaise, currency: "INR", receipt });
    } catch (err) {
      // Release the slot: nothing was created at Razorpay, so the customer must
      // be able to try again immediately.
      await PaymentOrder.deleteOne({ _id: reservation._id }).catch(() => {});
      reservation = null;
      throw new AppError(502, `Razorpay could not create the order (${err.message}). Nothing was charged.`);
    }

    // Promote the reservation to the real order. This row is the authority for
    // /verify.
    const persisted = await PaymentOrder.findOneAndUpdate(
      { _id: reservation._id },
      {
        $set: {
          razorpayOrderId: order.id,
          expiresAt: new Date(Date.now() + ORDER_TTL_HOURS * 60 * 60 * 1000),
        },
      },
      { new: true }
    );
    if (!persisted) {
      throw new AppError(
        500,
        "A Razorpay order was created but could not be recorded locally — reconcile with Razorpay before charging again"
      );
    }

    res.json({ order, key: process.env.RAZORPAY_KEY, amountPaise });
  } catch (err) {
    // Any failure after the reservation but before promotion would otherwise
    // hold the customer's single live-order slot for the full TTL.
    if (reservation) {
      await PaymentOrder.deleteOne({
        _id: reservation._id,
        razorpayOrderId: /^pending:/,
      }).catch(() => {});
    }
    next(err);
  }
});

/**
 * POST /api/payment/verify
 * Body: { razorpay_payment_id, razorpay_order_id, razorpay_signature }
 *
 * Verifies the HMAC-SHA256 signature and marks the resource that the locally
 * persisted order was created for as paid. The caller does not choose the
 * target: bookingId/invoiceId in the body are ignored, and any order id that
 * this server did not create (or that belongs to another company) is rejected.
 * Replay-safe: a second verification of the same order is a no-op.
 */
router.post("/verify", authRequired, async (req, res, next) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      throw new AppError(400, "razorpay_payment_id, razorpay_order_id and razorpay_signature are required");
    }
    if (!process.env.RAZORPAY_SECRET) {
      throw new AppError(503, "Razorpay is not configured on this server");
    }

    // Constant-time signature comparison to avoid timing leaks.
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(String(razorpay_signature), "hex");
    const signatureOk =
      expectedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, providedBuf);
    if (!signatureOk) {
      throw new AppError(400, "Invalid payment signature");
    }

    // Bind to a locally persisted order owned by the authenticated company.
    const order = await PaymentOrder.findOne({
      razorpayOrderId: razorpay_order_id,
      companyId: req.companyId,
    });
    if (!order) {
      throw new AppError(404, "Unknown payment order for this salon");
    }

    if (order.status === "paid") {
      return res.json({ msg: "Payment verified", updated: 0, alreadyPaid: true });
    }
    if (order.status !== "created") {
      // `expired` means Razorpay has auto-cancelled the order, so a signature
      // over it cannot correspond to a live payment. Refusing here is what stops
      // a long-abandoned checkout from settling a booking years later.
      throw new AppError(
        409,
        `This payment order is ${order.status} — raise a new order before paying`
      );
    }
    if (order.expiresAt && order.expiresAt.getTime() < Date.now()) {
      await expireLiveOrders(req.companyId, order.type, order.resourceId, "checkout window elapsed");
      throw new AppError(409, "This payment order has expired — raise a new order to continue");
    }

    // A signature only proves authenticity, not amount. Whenever the Razorpay
    // API is reachable we ask it what was actually paid and refuse to mark
    // anything paid unless the amount, currency and order match the row we
    // created. Without credentials (mock/local mode) the signature check stands
    // on its own and the amount is still pinned to our stored order.
    const rp = razorpayInstance();
    if (rp) {
      let payment;
      try {
        payment = await rp.payments.fetch(razorpay_payment_id);
      } catch (err) {
        throw new AppError(
          502,
          `Could not confirm this payment with Razorpay (${err.message}). Nothing was marked paid.`
        );
      }
      if (!payment || String(payment.order_id) !== String(razorpay_order_id)) {
        throw new AppError(400, "Payment does not belong to this order");
      }
      if (Number(payment.amount) !== Number(order.amountPaise)) {
        throw new AppError(
          400,
          `Payment amount mismatch: received ${payment.amount}, expected ${order.amountPaise}`
        );
      }
      if (payment.currency && String(payment.currency) !== String(order.currency)) {
        throw new AppError(400, `Unexpected currency ${payment.currency}`);
      }
      // Only a CAPTURED payment is money in the salon account. An
      // "authorized" payment is only a pre-authorisation: the hold can still be
      // released or expire, and if capture fails the booking is marked paid for
      // money that never arrived. Treat authorisation as not-yet-paid.
      if (!payment.status || String(payment.status) !== "captured") {
        throw new AppError(
          400,
          `Razorpay payment is "${payment.status || "unknown"}" — only a captured payment settles a booking or invoice`
        );
      }
    }

    let updated = 0;
    if (order.type === "booking") {
      // The booking must still be a live appointment. An order raised while the
      // slot was `booked` can be paid AFTER the customer cancels or no-shows —
      // without this filter that money would be attached to an appointment the
      // salon will never honour, and the booking's paymentStatus would flip to
      // paid with no corresponding service. A booking that has moved on is real
      // money needing a refund/reconciliation, which the 409 below reports.
      const booking = await Booking.findOneAndUpdate(
        {
          _id: order.resourceId,
          companyId: req.companyId,
          paymentStatus: { $ne: "paid" },
          status: "booked",
        },
        { $set: { paymentStatus: "paid" } },
        { new: true }
      );
      if (booking) updated++;
    } else {
      const invoice = await Invoice.findOneAndUpdate(
        { _id: order.resourceId, companyId: req.companyId, paymentStatus: { $ne: "paid" } },
        { $set: { paymentStatus: "paid" } },
        { new: true }
      );
      if (invoice) updated++;
    }

    // The resource was already settled, or the booking is no longer live. The
    // money is real, so record it on the order and tell the caller plainly
    // instead of reporting a fresh update.
    if (updated === 0) {
      order.status = "paid";
      order.razorpayPaymentId = razorpay_payment_id;
      order.paidAt = new Date();
      await order.save();
      const reason =
        order.type === "booking"
          ? "this booking is no longer live (cancelled, no-show or already completed)"
          : "this invoice was already marked paid";
      return res.status(409).json({
        msg: `Payment received, but ${reason} — refund or reconcile manually`,
        updated: 0,
        alreadyPaid: true,
      });
    }

    order.status = "paid";
    order.razorpayPaymentId = razorpay_payment_id;
    order.paidAt = new Date();
    await order.save();

    res.json({ msg: "Payment verified", updated });
  } catch (err) {
    next(err);
  }
});

/**
 * Retire real Razorpay orders whose checkout window has elapsed.
 *
 * Called by the cron. A row promoted to a real `razorpay_order_…` id used to
 * hold its one-live-order slot forever: the customer opened checkout, closed
 * the tab, and could never raise another order for that booking or invoice
 * again. The row is kept (status `expired`) rather than deleted — money may
 * have been attached to it, so it is audit evidence.
 *
 * Batched so a long-abandoned backlog cannot exhaust memory in one tick.
 */
async function expireStaleOrders() {
  const BATCH = 200;
  const now = new Date();
  let cursor = null;
  let total = 0;

  do {
    const batch = await PaymentOrder.find({
      status: "created",
      razorpayOrderId: { $not: /^pending:/ },
      expiresAt: { $ne: null, $lte: now },
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    })
      .select("_id")
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean();

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]._id;

    const res = await PaymentOrder.updateMany(
      { _id: { $in: batch.map((o) => o._id) }, status: "created" },
      { $set: { status: "expired", failureReason: `checkout window elapsed at ${now.toISOString()}` } }
    );
    total += res.modifiedCount;
  } while (true);

  if (total) console.log(`[payment] retired ${total} abandoned payment order(s)`);
  return total;
}

module.exports = router;

// Exported for the e2e suite and the cron: the "charge the balance, not
// grandTotal" rule is the single highest-impact business rule in this file and
// it is otherwise unreachable without live Razorpay credentials, so it would
// ship untested.
module.exports.resolvePayable = resolvePayable;
module.exports.expireLiveOrders = expireLiveOrders;
module.exports.expireStaleOrders = expireStaleOrders;
module.exports.ORDER_TTL_HOURS = ORDER_TTL_HOURS;
