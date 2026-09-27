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
  // Never selected by default and stripped from every JSON payload — the login
  // route must opt in with .select("+passwordHash").
  passwordHash: { type: String, required: true, select: false },
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

// Defense in depth: even if a document that contains the hash is serialized
// (explicitly selected, aggregate result, …) the hash never reaches a client.
companySchema.set("toJSON", {
  transform(doc, ret) {
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model("Company", companySchema);