const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  code: { type: String, required: true, uppercase: true, trim: true },
  title: { type: String, default: "" },
  discountType: { type: String, enum: ["percent", "flat"], default: "percent" },
  discountValue: { type: Number, required: true, min: 0 },
  minOrderAmount: { type: Number, default: 0 },
  maxDiscount: { type: Number, default: 0 }, // 0 = no cap
  applicableServices: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],
  applicablePackages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Package" }],
  usageLimit: { type: Number, default: 0 }, // 0 = unlimited
  usedCount: { type: Number, default: 0 },
  validFrom: { type: Date },
  validUntil: { type: Date },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

offerSchema.index({ companyId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("Offer", offerSchema);