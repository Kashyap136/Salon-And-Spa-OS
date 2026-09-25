const mongoose = require("mongoose");

const companySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  subdomain: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  ownerEmail: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  salonType: {
    type: String,
    enum: ["unisex", "men", "women", "spa"],
    default: "unisex",
  },
  location: { type: String, default: "" },
  upiId: { type: String, default: "" },
  gstNo: { type: String, default: "" },
  language: {
    type: String,
    enum: ["Marathi", "Hindi", "English"],
    default: "Marathi",
  },
  whatsappEnabled: { type: Boolean, default: true },
  razorpayKey: { type: String, default: "" },
  logoUrl: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Company", companySchema);