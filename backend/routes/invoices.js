const express = require("express");
const Invoice = require("../models/Invoice");
const Company = require("../models/Company");
const { authRequired, authOptional } = require("../middleware/auth");
const { effectiveCompany, isValidObjectId, isYMD, AppError } = require("../utils/helpers");
const { generateInvoicePdf } = require("../utils/pdf");

const router = express.Router();

// GET /api/invoices/list?companyId=&date=YYYY-MM-DD — newest first, max 100.
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const filter = { companyId };
    if (isYMD(req.query.date)) {
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
router.get("/pdf/:id", authOptional, async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) throw new AppError(400, "Invalid invoice id");

    const companyId = effectiveCompany(req, req.query.companyId);
    const invoice = await Invoice.findOne({ _id: req.params.id, companyId }).populate("items.service");
    if (!invoice) throw new AppError(404, "Invoice not found");

    let company = req.company || null;
    if (!company && companyId) {
      company = await Company.findById(companyId).catch(() => null);
    }
    const { filePath } = await generateInvoicePdf({ company, invoice });
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

module.exports = router;