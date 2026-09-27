const express = require("express");
const Invoice = require("../models/Invoice");
const Company = require("../models/Company");
const { authRequired } = require("../middleware/auth");
const { isValidObjectId, isRealDate, AppError } = require("../utils/helpers");
const { generateInvoicePdf } = require("../utils/pdf");

const router = express.Router();

// GET /api/invoices/list?date=YYYY-MM-DD — authenticated, company-scoped.
// Invoices carry customer name/phone/totals and are financial records; they
// must never be readable anonymously.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const filter = { companyId: req.companyId };
    if (req.query.date) {
      if (!isRealDate(req.query.date)) {
        throw new AppError(400, "date must be a real date in YYYY-MM-DD format");
      }
      filter.createdAt = {
        $gte: new Date(`${req.query.date}T00:00:00`),
        $lte: new Date(`${req.query.date}T23:59:59.999`),
      };
    }

    const invoices = await Invoice.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json(invoices);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/pay — { invoiceId }
router.post("/pay", authRequired, async (req, res, next) => {
  try {
    const { invoiceId } = req.body;
    if (!isValidObjectId(invoiceId)) throw new AppError(400, "Invalid invoice id");

    const invoice = await Invoice.findOne({ _id: invoiceId, companyId: req.companyId });
    if (!invoice) throw new AppError(404, "Invoice not found");

    invoice.paymentStatus = "paid";
    await invoice.save();
    res.json({ msg: "Invoice marked as paid", invoice });
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/pdf/:id — generated invoice PDF (PDFKit + UPI QR code).
// Authenticated and scoped to the caller's own company (no companyId query trust).
router.get("/pdf/:id", authRequired, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new AppError(400, "Invalid invoice id");

    const invoice = await Invoice.findOne({ _id: req.params.id, companyId: req.companyId }).populate(
      // Tenant-pinned: a corrupt line item must not put another salon's service
      // name and price onto this invoice PDF.
      { path: "items.service", match: { companyId: req.companyId } }
    );
    if (!invoice) throw new AppError(404, "Invoice not found");

    const company = req.company || (await Company.findById(req.companyId).catch(() => null));
    if (!company) throw new AppError(404, "Salon not found for this invoice");
    const { filePath, fileName } = await generateInvoicePdf({ company, invoice });
    // res.download (not sendFile) so Content-Disposition and the application/pdf
    // content type are explicit — otherwise the response can be rendered
    // inline instead of saved.
    res.download(filePath, fileName);
  } catch (err) {
    next(err);
  }
});

module.exports = router;