const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
  customerName: { type: String, default: "" },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

// One review per booking — a guest cannot stack reviews on a single visit.
reviewSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { bookingId: { $exists: true } } }
);

module.exports = mongoose.model("Review", reviewSchema);