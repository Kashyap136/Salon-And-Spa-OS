const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ["hair", "skin", "spa", "nails", "beard", "makeup"],
    required: true,
  },
  durationMins: { type: Number, default: 30 },
  price: { type: Number, required: true, min: 0 },
  gender: { type: String, enum: ["M", "F", "U"], default: "U" },
  isCombo: { type: Boolean, default: false },
  comboServices: [{ type: mongoose.Schema.Types.ObjectId, ref: "Service" }],
  imageUrl: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

serviceSchema.index({ companyId: 1, category: 1 });

module.exports = mongoose.model("Service", serviceSchema);