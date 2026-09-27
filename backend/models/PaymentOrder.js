const mongoose = require("mongoose");

/**
 * A Razorpay order that this server actually created, bound to the exact
 * company + resource + amount it was created for.
 *
 * Payment verification must be anchored to one of these rows: the client is
 * never allowed to name the booking/invoice it is paying for. Without this,
 * a valid signature obtained from any order could be replayed to mark an
 * unrelated booking or invoice as paid.
 */
const paymentOrderSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  // What is being paid for: a booking advance or an invoice balance.
  type: { type: String, enum: ["booking", "invoice"], required: true },
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
  },
  amountPaise: { type: Number, required: true, min: 1 },
  currency: { type: String, default: "INR" },
  /**
   * Either the real Razorpay order id, or a `pending:<uuid>` placeholder written
   * *before* the remote call. See routes/payment.js — the placeholder is what
   * lets the unique index below arbitrate concurrent create-order requests.
   */
  razorpayOrderId: { type: String, required: true, unique: true, index: true },
  razorpayPaymentId: { type: String, default: "" },
  /**
   * `created` — live, holds the one-order-per-resource slot.
   * `paid`    — money captured.
   * `failed`  — remote order failed or was released; slot is free.
   * `expired` — the customer abandoned the checkout window. Unlike `failed`
   *             this row is kept for audit: real money may have been attached
   *             to it, so it must never be silently deleted.
   */
  status: {
    type: String,
    enum: ["created", "paid", "failed", "expired"],
    default: "created",
  },
  createdAt: { type: Date, default: Date.now },
  paidAt: { type: Date, default: null },
  /**
   * When a real Razorpay order stops being payable. Razorpay auto-cancels an
   * unpaid order after 24h; matching that locally means an abandoned checkout
   * cannot block the customer from ever trying again, and the one-live-order
   * index stops counting a dead order as live.
   */
  expiresAt: { type: Date, default: null },
});

paymentOrderSchema.index({ companyId: 1, createdAt: -1 });
/** Supports the abandoned-order reaper: find live orders past their expiry. */
paymentOrderSchema.index({ status: 1, expiresAt: 1 });
/**
 * Database backstop for "one live order per resource".
 *
 * The application also checks this before calling Razorpay, but check-then-act
 * with a network call in the middle is not a guarantee: two concurrent requests
 * both passed the check and both created real, payable orders. This partial
 * unique index makes the second insert fail (11000) instead.
 *
 * `{ status: "created" }` — not `$ne` — because MongoDB rejects `$ne` in
 * partialFilterExpression.
 */
paymentOrderSchema.index(
  { companyId: 1, type: 1, resourceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "created" },
    name: "one_live_payment_order_per_resource",
  }
);

module.exports = mongoose.model("PaymentOrder", paymentOrderSchema);
