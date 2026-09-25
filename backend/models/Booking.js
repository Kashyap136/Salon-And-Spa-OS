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
  // Stored as YYYY-MM-DD (matches the frontend date inputs / calendar grouping).
  bookingDate: { type: String, required: true },
  // 30-minute window, e.g. "10:00-10:30".
  slot: { type: String, required: true },
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
    enum: ["booked", "completed", "no-show", "cancelled"],
    default: "booked",
  },
  isPackage: { type: Boolean, default: false },
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: "Package", default: null },
  offerId: { type: mongoose.Schema.Types.ObjectId, ref: "Offer", default: null },
  discountApplied: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Double-booking guard: one booking per company + staff + date + slot.
// Cancelled (and only cancelled) bookings free the slot.
bookingSchema.index(
  { companyId: 1, staffId: 1, bookingDate: 1, slot: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: "cancelled" } } }
);

module.exports = mongoose.model("Booking", bookingSchema);