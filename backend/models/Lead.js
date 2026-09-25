const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  message: { type: String, default: "" },
  source: { type: String, default: "public" },
  status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Lead", leadSchema);