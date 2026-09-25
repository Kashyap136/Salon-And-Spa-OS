const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  brand: { type: String, default: "" },
  price: { type: Number, required: true, min: 0 },
  gstPercent: { type: Number, default: 18 },
  stock: { type: Number, default: 0 },
  minStock: { type: Number, default: 5 },
  category: { type: String, default: "retail" },
  images: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Product", productSchema);