const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Service = require("../models/Service");
const { AppError, isValidObjectId, toNumber } = require("./helpers");

const GST_RATE = 0.18;

function nextInvoiceNo() {
  const year = new Date().getFullYear();
  return `INV-${year}-${String(Date.now()).slice(-6)}`;
}

/**
 * Complete a booking: create the invoice (service item + optional retail
 * products), deduct product stock, compute GST, staff commission and grand
 * total, then flip the booking status to "completed".
 */
async function completeBooking(booking, companyId, productsUsed = []) {
  const service = booking.serviceId || (await Service.findById(booking.serviceId));
  if (!service) throw new AppError(404, "Service not found for this booking");

  const staff = booking.staffId;
  const serviceTotal = toNumber(service.price);
  const items = [{ service: service._id, price: serviceTotal }];

  const productLines = [];
  let productsTotal = 0;

  if (Array.isArray(productsUsed)) {
    for (const raw of productsUsed) {
      const line = raw && typeof raw === "object" ? raw : {};
      const pid = line.productId || line._id || raw;
      const qty = Math.max(1, Math.round(toNumber(line.qty) || 1));
      if (!isValidObjectId(pid)) continue;

      const product = await Product.findOne({ _id: pid, companyId });
      if (!product) throw new AppError(404, `Product ${pid} not found`);
      if (product.stock < qty) {
        throw new AppError(400, `Insufficient stock for ${product.name} (only ${product.stock} left)`);
      }
      product.stock -= qty;
      await product.save();

      const linePrice = product.price * qty;
      productsTotal += linePrice;
      productLines.push({ productId: product._id, qty, price: linePrice });
    }
  }

  const total = serviceTotal + productsTotal;
  const discount = toNumber(booking.discountApplied);
  const gstTotal = Math.round(total * GST_RATE);
  const grandTotal = Math.max(total + gstTotal - discount, 0);
  const staffCommission = Math.round(
    (serviceTotal * (staff && staff.commissionPercent ? staff.commissionPercent : 0)) / 100
  );

  const invoice = await Invoice.create({
    companyId,
    bookingId: booking._id,
    customerName: booking.customerName,
    phone: booking.phone,
    items,
    products: productLines,
    offerDiscount: discount,
    total,
    gstTotal,
    discount,
    grandTotal,
    paymentMode: booking.paymentMode || "UPI",
    paymentStatus: "pending",
    invoiceNo: nextInvoiceNo(),
    staffCommission,
  });

  booking.status = "completed";
  await booking.save();
  return invoice;
}

module.exports = { completeBooking, nextInvoiceNo, GST_RATE };