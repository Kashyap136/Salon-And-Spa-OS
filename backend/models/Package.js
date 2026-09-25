const mongoose = require("mongoose");

const packageServiceSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", required: true },
    qty: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

const packageSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  services: [packageServiceSchema],
  price: { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, required: true, min: 0 },
  savings: { type: Number, default: 0 },
  validityDays: { type: Number, default: 30 },
  imageUrl: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Package", packageSchema);