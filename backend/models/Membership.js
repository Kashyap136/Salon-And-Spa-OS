const mongoose = require("mongoose");

const membershipSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  customerName: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: "Package", required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  servicesUsed: [
    {
      serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
      usedDate: { type: Date, default: Date.now },
    },
  ],
  servicesTotal: { type: Number, default: 0 },
  status: { type: String, enum: ["active", "expired"], default: "active" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Membership", membershipSchema);