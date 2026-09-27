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
const { authRequired } = require("../middleware/auth");
const { AppError, toNumber, localYMD, round2 } = require("../utils/helpers");
const { rateLimit } = require("../utils/rateLimit");

const router = express.Router();

// Exports are financial/PII records: written outside any static mount and only
// served back through the authenticated /api/audit/download route.
const EXPORT_DIR = path.join(__dirname, "..", "exports", "audit");

/**
 * Row caps per sheet.
 *
 * The workbook is built entirely in memory, so an unbounded year of data is an
 * authenticated memory-exhaustion vector: one request could pull a hundred
 * thousand fully-populated Mongoose documents and hold them all at once while
 * ExcelJS allocates the row buffers. A real salon produces a few thousand rows
 * a year, so these caps sit far above legitimate use; when one is hit the
 * response says so explicitly rather than silently truncating a financial
 * record.
 */
const MAX_ROWS = {
  bookings: 20000,
  invoices: 20000,
  products: 5000,
  memberships: 20000,
  offers: 500,
  staff: 1000,
};

/** Generating a workbook is expensive; bound it per company. */
const exportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Too many export requests — please wait a few minutes.",
});

function exportFileName(year, companyId) {
  return `audit-${year}-${String(companyId).toLowerCase()}.xlsx`;
}

function parseYear(raw) {
  const year = toNumber(raw) || new Date().getFullYear();
  if (year < 2000 || year > 2999) throw new AppError(400, "year is out of range");
  return year;
}

/**
 * GET /api/audit/export?year=2026
 * Export yearly audit data (bookings, invoices, commission, products,
 * memberships, offers) to an Excel workbook. Authenticated and scoped to the
 * caller's own company.
 */
router.get("/export", exportLimiter, authRequired, async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const year = parseYear(req.query.year);
    const start = new Date(`${year}-01-01T00:00:00`);
    const end = new Date(`${year}-12-31T23:59:59.999`);

    // Always fetch one row past each cap so a truncated export is detectable
    // (and reportable) rather than quietly missing records.
    const [bookings, invoices, products, memberships, offers, staff] = await Promise.all([
      Booking.find({ companyId, createdAt: { $gte: start, $lte: end } })
        // Tenant-pinned populations: an export must not be able to pull another
        // salon's service/staff names in through a corrupt reference.
        .populate({ path: "serviceId", match: { companyId } })
        .populate({ path: "staffId", match: { companyId } })
        .sort({ createdAt: 1 })
        .limit(MAX_ROWS.bookings + 1),
      Invoice.find({ companyId, createdAt: { $gte: start, $lte: end } })
        .populate({ path: "items.service", match: { companyId } })
        .sort({ createdAt: 1 })
        .limit(MAX_ROWS.invoices + 1),
      Product.find({ companyId }).limit(MAX_ROWS.products + 1),
      Membership.find({ companyId })
        .populate({ path: "packageId", match: { companyId } })
        .limit(MAX_ROWS.memberships + 1),
      Offer.find({ companyId }).limit(MAX_ROWS.offers + 1),
      Staff.find({ companyId }).limit(MAX_ROWS.staff + 1),
    ]);

    const truncated = {
      bookings: bookings.length > MAX_ROWS.bookings,
      invoices: invoices.length > MAX_ROWS.invoices,
      products: products.length > MAX_ROWS.products,
      memberships: memberships.length > MAX_ROWS.memberships,
      offers: offers.length > MAX_ROWS.offers,
      staff: staff.length > MAX_ROWS.staff,
    };
    if (bookings.length > MAX_ROWS.bookings) bookings.length = MAX_ROWS.bookings;
    if (invoices.length > MAX_ROWS.invoices) invoices.length = MAX_ROWS.invoices;
    if (products.length > MAX_ROWS.products) products.length = MAX_ROWS.products;
    if (memberships.length > MAX_ROWS.memberships) memberships.length = MAX_ROWS.memberships;
    if (offers.length > MAX_ROWS.offers) offers.length = MAX_ROWS.offers;
    if (staff.length > MAX_ROWS.staff) staff.length = MAX_ROWS.staff;
    if (Object.values(truncated).some(Boolean)) {
      console.warn(`[audit] export for ${companyId} / ${year} hit a row cap:`, truncated);
    }

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

    // Index the bookings by id: the previous `bookings.find(...)` inside this
    // loop made the export O(invoices x bookings).
    const bookingById = new Map(bookings.map((b) => [String(b._id), b]));

    for (const inv of invoices) {
      const booking = bookingById.get(String(inv.bookingId));
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
        // The invoice is the authority for commission — it was computed from the
        // booking-time price snapshot and the staff's rate at completion. The
        // "Staff Commission" sheet used to recompute it from booking.total, which
        // is post-discount, excludes GST and ignores products, so one workbook
        // reported two different numbers for the same appointment.
        commission: inv.staffCommission,
        date: localYMD(new Date(inv.createdAt)),
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

    // Roll up from the invoices, which is where commission was actually
    // calculated, so this sheet agrees with the Audit sheet to the rupee.
    const rollup = new Map();
    for (const s of staff) {
      rollup.set(String(s._id), {
        staff: s.name,
        completed: 0,
        revenue: 0,
        pct: s.commissionPercent || 0,
        commission: 0,
      });
    }
    for (const inv of invoices) {
      const booking = bookingById.get(String(inv.bookingId));
      const staffId = booking && booking.staffId ? String(booking.staffId._id) : null;
      if (!staffId || !rollup.has(staffId)) continue;
      const row = rollup.get(staffId);
      row.completed += 1;
      row.revenue = round2(row.revenue + (Number(inv.total) || 0));
      row.commission = round2(row.commission + (Number(inv.staffCommission) || 0));
    }
    for (const row of rollup.values()) commissionSheet.addRow(row);

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
        start: m.startDate ? localYMD(new Date(m.startDate)) : "—",
        end: m.endDate ? localYMD(new Date(m.endDate)) : "—",
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
        from: o.validFrom ? localYMD(new Date(o.validFrom)) : "—",
        until: o.validUntil ? localYMD(new Date(o.validUntil)) : "—",
        active: o.isActive ? "yes" : "no",
      });
    }

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const fileName = exportFileName(year, companyId);
    const filePath = path.join(EXPORT_DIR, fileName);
    const tmpPath = path.join(
      EXPORT_DIR,
      `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
    );
    await workbook.xlsx.writeFile(tmpPath);
    // Atomic swap so a concurrent download never reads a partial workbook.
    fs.renameSync(tmpPath, filePath);

    res.json({
      // Authenticated download endpoint — not a static, guessable file path.
      fileUrl: `/api/audit/download?year=${year}`,
      count: invoices.length,
      // Surfaced, never silent: a capped export must not be mistaken for a
      // complete one.
      truncated,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/audit/download?year=2026 — stream a previously generated export.
// Authenticated and scoped to the caller's own company.
router.get("/download", exportLimiter, authRequired, async (req, res, next) => {
  try {
    const year = parseYear(req.query.year);
    const filePath = path.join(EXPORT_DIR, exportFileName(year, req.companyId));
    if (!fs.existsSync(filePath)) {
      throw new AppError(404, "No export found for that year — generate it first");
    }
    // Force a download and declare the type: sendFile() alone infers
    // Content-Type from the extension and sets no Content-Disposition, so the
    // response could be rendered as a page rather than saved.
    res.download(filePath, exportFileName(year, req.companyId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;