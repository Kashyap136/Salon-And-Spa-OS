const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: "" },
  specialization: {
    type: String,
    enum: ["hair", "skin", "spa", "nails", "makeup"],
    default: "hair",
  },
  experienceYears: { type: Number, default: 0 },
  salary: { type: Number, default: 0 },
  commissionPercent: { type: Number, default: 10 },
  esslId: { type: String, default: "" },
  photoUrl: { type: String, default: "" },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Staff", staffSchema);