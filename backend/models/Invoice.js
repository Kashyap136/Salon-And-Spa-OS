const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
  customerName: { type: String, required: true },
  phone: { type: String, default: "" },
  items: [
    {
      service: { type: mongoose.Schema.Types.ObjectId, ref: "Service" },
      price: { type: Number, default: 0 },
    },
  ],
  products: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
      qty: { type: Number, default: 1 },
      price: { type: Number, default: 0 },
    },
  ],
  offerDiscount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  gstTotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  grandTotal: { type: Number, default: 0 },
  paymentMode: { type: String, default: "UPI" },
  paymentStatus: { type: String, enum: ["pending", "paid"], default: "pending" },
  invoiceNo: { type: String, required: true },
  staffCommission: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

invoiceSchema.index({ companyId: 1, createdAt: -1 });
invoiceSchema.index({ companyId: 1, invoiceNo: 1 }, { unique: true });

module.exports = mongoose.model("Invoice", invoiceSchema);