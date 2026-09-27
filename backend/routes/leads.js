const express = require("express");
const Lead = require("../models/Lead");
const Company = require("../models/Company");
const { authRequired } = require("../middleware/auth");
const { isValidObjectId, AppError } = require("../utils/helpers");
const { rateLimit } = require("../utils/rateLimit");

const router = express.Router();

// The inquiry form is public, so bound how much one client can submit.
const publicWriteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40 });

// POST /api/leads/create — { companyId, name, phone, message, source }
router.post("/create", publicWriteLimiter, async (req, res, next) => {
  try {
    const { companyId, name, phone, message, source } = req.body;
    if (!isValidObjectId(companyId)) throw new AppError(400, "Invalid companyId");
    if (!name || !phone) throw new AppError(400, "name and phone are required");
    if (String(name).length > 120 || String(phone).length > 32) {
      throw new AppError(400, "name or phone is too long");
    }
    if (String(message || "").length > 2000) {
      throw new AppError(400, "message is too long (2000 characters max)");
    }

    const company = await Company.findById(companyId);
    if (!company) throw new AppError(404, "Salon not found");

    const lead = await Lead.create({
      companyId,
      name: String(name).trim(),
      phone,
      message: message || "",
      source: source || "public",
      status: "new",
    });

    // WhatsApp follow-up support: log a ready-to-send greeting (no customer PII).
    console.log(
      `[lead] new inquiry for ${company.name} (source=${lead.source}) — follow-up on WhatsApp`
    );

    res.status(201).json({ _id: lead._id, name: lead.name, phone: lead.phone, message: lead.message, source: lead.source, status: lead.status, createdAt: lead.createdAt });
  } catch (err) {
    next(err);
  }
});

// GET /api/leads/list — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const leads = await Lead.find({ companyId: req.companyId }).sort({ createdAt: -1 }).limit(500);
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

// POST /api/leads/status — { leadId, status }
// Authenticated and scoped to the caller's own company.
router.post("/status", authRequired, async (req, res, next) => {
  try {
    const { leadId, status } = req.body;
    if (!isValidObjectId(leadId)) throw new AppError(400, "Invalid lead id");
    if (!["new", "contacted", "closed"].includes(status)) {
      throw new AppError(400, "status must be new, contacted or closed");
    }
    const lead = await Lead.findOneAndUpdate(
      { _id: leadId, companyId: req.companyId },
      { status },
      { new: true }
    );
    if (!lead) throw new AppError(404, "Lead not found");
    res.json(lead);
  } catch (err) {
    next(err);
  }
});

module.exports = router;