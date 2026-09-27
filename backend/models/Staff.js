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
    // Mirrors the Service category list — a salon that sells "beard" services
    // must be able to file a beard specialist.
    enum: ["hair", "skin", "spa", "nails", "beard", "makeup"],
    default: "hair",
  },
  experienceYears: { type: Number, default: 0 },
  salary: { type: Number, default: 0 },
  commissionPercent: { type: Number, default: 10, min: 0, max: 100 },
  // Optional device (eSSL) id. Left undefined when not provided so the
  // tenant-scoped unique index below never collides on empty strings.
  esslId: { type: String, default: undefined, trim: true },
  photoUrl: { type: String, default: "" },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  createdAt: { type: Date, default: Date.now },
});

// One device id per salon. Without this, `Staff.findOne({ esslId })` during an
// attendance sync could pick an arbitrary tenant's staff member.
staffSchema.index(
  { companyId: 1, esslId: 1 },
  { unique: true, partialFilterExpression: { esslId: { $type: "string" } } }
);

module.exports = mongoose.model("Staff", staffSchema);