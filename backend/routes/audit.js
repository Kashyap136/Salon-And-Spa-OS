const path = require("path");
const fs = require("fs");
const express = require("express");
const ExcelJS = require("exceljs");
const Booking = require("../models/Booking");
const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Membership = require("../models/Membership");
const Offer = require("../models/Offer");
const Staff = require("../models/Staff");
const { authOptional } = require("../middleware/auth");
const { effectiveCompany, AppError, toNumber } = require("../utils/helpers");

const router = express.Router();

const EXPORT_DIR = path.join(__dirname, "..", "public", "exports");

/**
 * GET /api/audit/export?companyId=&year=2026
 * Export yearly audit data (bookings, invoices, commission, products,
 * memberships, offers) to an Excel workbook under /public/exports/.
 */
router.get("/export", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) throw new AppError(400, "companyId is required");

    const year = toNumber(req.query.year) || new Date().getFullYear();
    const start = new Date(`${year}-01-01T00:00:00`);
    const end = new Date(`${year}-12-31T23:59:59.999`);

    const [bookings, invoices, products, memberships, offers, staff] = await Promise.all([
      Booking.find({ companyId, createdAt: { $gte: start, $lte: end } })
        .populate("serviceId")
        .populate("staffId"),
      Invoice.find({ companyId, createdAt: { $gte: start, $lte: end } })
        .populate("items.service")
        .sort({ createdAt: 1 }),
      Product.find({ companyId }),
      Membership.find({ companyId }).populate("packageId"),
      Offer.find({ companyId }),
      Staff.find({ companyId }),
    ]);

    const invoiceByBooking = new Map(invoices.map((i) => [String(i.bookingId || ""), i]));
    const staffById = new Map(staff.map((s) => [String(s._id), s]));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Salon & Spa OS";
    workbook.created = new Date();

    // Audit worksheet — the main summary.
    const auditSheet = workbook.addWorksheet("Audit");
    auditSheet.columns = [
      { header: "InvoiceNo", key: "invoiceNo", width: 18 },
      { header: "Customer", key: "customer", width: 22 },
      { header: "Phone", key: "phone", width: 14 },
      { header: "Service", key: "service", width: 22 },
      { header: "Staff", key: "staff", width: 18 },
      { header: "Total", key: "total", width: 10 },
      { header: "Commission", key: "commission", width: 12 },
      { header: "Date", key: "date", width: 14 },
    ];
    auditSheet.getRow(1).font = { bold: true };

    for (const inv of invoices) {
      const booking = bookings.find((b) => String(b._id) === String(inv.bookingId));
      const serviceName =
        inv.items && inv.items[0] && inv.items[0].service && inv.items[0].service.name
          ? inv.items[0].service.name
          : "Service";
      auditSheet.addRow({
        invoiceNo: inv.invoiceNo,
        customer: inv.customerName,
        phone: inv.phone,
        service: serviceName,
        staff: booking && booking.staffId ? booking.staffId.name : "—",
        total: inv.total,
        commission: inv.staffCommission,
        date: inv.createdAt.toISOString().slice(0, 10),
      });
    }

    // Bookings by date.
    const bookingSheet = workbook.addWorksheet("Bookings");
    bookingSheet.columns = [
      { header: "Customer", key: "customer", width: 22 },
      { header: "Phone", key: "phone", width: 14 },
      { header: "Service", key: "service", width: 22 },
      { header: "Staff", key: "staff", width: 18 },
      { header: "Date", key: "date", width: 12 },
      { header: "Slot", key: "slot", width: 14 },
      { header: "Total", key: "total", width: 10 },
      { header: "Advance", key: "advance", width: 10 },
      { header: "Status", key: "status", width: 12 },
      { header: "Payment", key: "payment", width: 10 },
    ];
    bookingSheet.getRow(1).font = { bold: true };
    for (const b of bookings) {
      bookingSheet.addRow({
        customer: b.customerName,
        phone: b.phone,
        service: b.serviceId && b.serviceId.name ? b.serviceId.name : "—",
        staff: b.staffId && b.staffId.name ? b.staffId.name : "—",
        date: b.bookingDate,
        slot: b.slot,
        total: b.total,
        advance: b.advancePaid,
        status: b.status,
        payment: b.paymentStatus,
      });
    }

    // Staff commission.
    const commissionSheet = workbook.addWorksheet("Staff Commission");
    commissionSheet.columns = [
      { header: "Staff", key: "staff", width: 22 },
      { header: "Completed", key: "completed", width: 12 },
      { header: "Revenue", key: "revenue", width: 12 },
      { header: "Commission %", key: "pct", width: 14 },
      { header: "Commission", key: "commission", width: 12 },
    ];
    commissionSheet.getRow(1).font = { bold: true };
    const completedByStaff = bookings.filter((b) => b.status === "completed");
    for (const s of staff) {
      const rows = completedByStaff.filter((b) => String(b.staffId?._id) === String(s._id));
      const revenue = rows.reduce((sum, b) => sum + (b.total || 0), 0);
      const pct = s.commissionPercent || 0;
      commissionSheet.addRow({
        staff: s.name,
        completed: rows.length,
        revenue,
        pct,
        commission: Math.round((revenue * pct) / 100),
      });
    }

    // Products.
    const productSheet = workbook.addWorksheet("Products");
    productSheet.columns = [
      { header: "Name", key: "name", width: 22 },
      { header: "Brand", key: "brand", width: 18 },
      { header: "Price", key: "price", width: 10 },
      { header: "GST %", key: "gst", width: 8 },
      { header: "Stock", key: "stock", width: 8 },
      { header: "Min Stock", key: "minStock", width: 10 },
    ];
    productSheet.getRow(1).font = { bold: true };
    for (const p of products) {
      productSheet.addRow({ name: p.name, brand: p.brand, price: p.price, gst: p.gstPercent, stock: p.stock, minStock: p.minStock });
    }

    // Memberships.
    const membershipSheet = workbook.addWorksheet("Memberships");
    membershipSheet.columns = [
      { header: "Customer", key: "customer", width: 22 },
      { header: "Phone", key: "phone", width: 14 },
      { header: "Package", key: "package", width: 22 },
      { header: "Start", key: "start", width: 12 },
      { header: "End", key: "end", width: 12 },
      { header: "Used", key: "used", width: 8 },
      { header: "Total", key: "total", width: 8 },
      { header: "Status", key: "status", width: 10 },
    ];
    membershipSheet.getRow(1).font = { bold: true };
    for (const m of memberships) {
      membershipSheet.addRow({
        customer: m.customerName,
        phone: m.phone,
        package: m.packageId ? m.packageId.name : "—",
        start: m.startDate.toISOString().slice(0, 10),
        end: m.endDate.toISOString().slice(0, 10),
        used: (m.servicesUsed || []).length,
        total: m.servicesTotal,
        status: m.status,
      });
    }

    // Offers.
    const offerSheet = workbook.addWorksheet("Offers");
    offerSheet.columns = [
      { header: "Code", key: "code", width: 14 },
      { header: "Title", key: "title", width: 24 },
      { header: "Type", key: "type", width: 10 },
      { header: "Value", key: "value", width: 10 },
      { header: "Used", key: "used", width: 8 },
      { header: "Limit", key: "limit", width: 8 },
      { header: "Valid From", key: "from", width: 12 },
      { header: "Valid Until", key: "until", width: 12 },
      { header: "Active", key: "active", width: 8 },
    ];
    offerSheet.getRow(1).font = { bold: true };
    for (const o of offers) {
      offerSheet.addRow({
        code: o.code,
        title: o.title,
        type: o.discountType,
        value: o.discountValue,
        used: o.usedCount,
        limit: o.usageLimit,
        from: o.validFrom ? o.validFrom.toISOString().slice(0, 10) : "—",
        until: o.validUntil ? o.validUntil.toISOString().slice(0, 10) : "—",
        active: o.isActive ? "yes" : "no",
      });
    }

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const fileName = `audit-${year}-${companyId.toLowerCase()}.xlsx`;
    const filePath = path.join(EXPORT_DIR, fileName);
    await workbook.xlsx.writeFile(filePath);

    res.json({
      fileUrl: `/public/exports/${fileName}`,
      count: invoices.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;