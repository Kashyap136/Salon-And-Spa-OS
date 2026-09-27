const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  customerName: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  email: { type: String, default: "" },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
  // Price/name snapshot taken at booking time so a later service price change
  // cannot silently rewrite the value the customer agreed to.
  serviceName: { type: String, default: "" },
  servicePrice: { type: Number, default: 0 },
  serviceDurationMins: { type: Number, default: 30 },
  // Stored as YYYY-MM-DD (matches the frontend date inputs / calendar grouping).
  bookingDate: { type: String, required: true },
  // Requested start window, e.g. "10:00-10:30".
  slot: { type: String, required: true },
  /**
   * Every 30-minute window the service occupies. A 45-minute service started
   * at 10:00 occupies ["10:00-10:30","10:30-11:00"], so an overlapping booking
   * is rejected at the database level, not only in application code.
   *
   * `validate` is deliberate: an empty array holds *no* slot, so it would be
   * invisible to both the unique index below and the pre-flight collision check
   * — a silent way to lose the double-booking guarantee. A booking must always
   * declare at least the window it starts in.
   */
  occupiedSlots: {
    type: [String],
    required: true,
    validate: {
      validator: (v) => Array.isArray(v) && v.length > 0,
      message: "occupiedSlots must list at least the 30-minute window the booking starts in",
    },
  },
  /**
   * False once cancelled, which is what frees the slot. Kept as an explicit
   * boolean so the unique index below can use a supported partial filter
   * (`{ activeSlot: true }`) — MongoDB rejects `$ne` in partialFilterExpression.
   */
  activeSlot: { type: Boolean, default: true },
  advancePaid: { type: Number, default: 0 },
  advancePercent: { type: Number, default: 20 },
  total: { type: Number, default: 0 },
  paymentMode: {
    type: String,
    enum: ["UPI", "Cash", "Razorpay"],
    default: "UPI",
  },
  paymentStatus: { type: String, enum: ["pending", "paid"], default: "pending" },
  status: {
    type: String,
    // "completing" is an internal, in-flight marker: a completed booking can
    // never produce a second invoice because the state transition is claimed
    // atomically before any side effect runs.
    enum: ["booked", "completing", "completed", "no-show", "cancelled"],
    default: "booked",
  },
  /**
   * When the `completing` claim was taken. If the process dies mid-completion
   * the claim would otherwise wedge the booking forever: every status change is
   * filtered on `status: "booked"`, so reception could neither complete,
   * cancel nor no-show it. The cron reaper (and a stale-claim steal on manual
   * retry) resets rows older than STALE_CLAIM_MINUTES.
   */
  completingAt: { type: Date, default: null },
  /**
   * Fencing token for the `completing` claim.
   *
   * A claim can be stolen once it goes stale, so "is this row still status:
   * completing?" is not enough to prove ownership — the stealing worker now
   * holds a *different* claim. Every update that finishes or releases a
   * completion must therefore match this token as well; a worker that lost its
   * lease updates nothing and aborts instead of flipping a booking another
   * process is in the middle of invoicing.
   */
  completionToken: { type: String, default: null },
  // When the appointment was actually completed (distinct from createdAt, and
  // from the moment the internal `completing` claim was taken).
  completedAt: { type: Date, default: null },
  isPackage: { type: Boolean, default: false },
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: "Package", default: null },
  offerId: { type: mongoose.Schema.Types.ObjectId, ref: "Offer", default: null },
  discountApplied: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Double-booking guard, enforced by MongoDB.
// A unique compound index on the multikey `occupiedSlots` array means two
// active bookings for the same company + staff + date may never share a
// 30-minute window, regardless of application-level check ordering.
bookingSchema.index(
  { companyId: 1, staffId: 1, bookingDate: 1, occupiedSlots: 1 },
  { unique: true, partialFilterExpression: { activeSlot: true } }
);

bookingSchema.index({ companyId: 1, bookingDate: 1, slot: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
