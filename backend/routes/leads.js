const express = require("express");
const Lead = require("../models/Lead");
const Company = require("../models/Company");
const { authOptional } = require("../middleware/auth");
const { effectiveCompany, isValidObjectId, AppError } = require("../utils/helpers");

const router = express.Router();

// POST /api/leads/create — { companyId, name, phone, message, source }
router.post("/create", async (req, res, next) => {
  try {
    const { companyId, name, phone, message, source } = req.body;
    if (!isValidObjectId(companyId)) throw new AppError(400, "Invalid companyId");
    if (!name || !phone) throw new AppError(400, "name and phone are required");

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

    // WhatsApp follow-up support: log a ready-to-send greeting.
    console.log(
      `[lead] new inquiry from ${lead.name} (${lead.phone}) for ${company.name} — follow-up on WhatsApp`
    );

    res.status(201).json(lead);
  } catch (err) {
    next(err);
  }
});

// GET /api/leads/list?companyId= — optional auth, company scoped.
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);
    const leads = await Lead.find({ companyId }).sort({ createdAt: -1 });
    res.json(leads);
  } catch (err) {
    next(err);
  }
});

// POST /api/leads/status — { leadId, status }
router.post("/status", authOptional, async (req, res, next) => {
  try {
    const { leadId, status } = req.body;
    if (!isValidObjectId(leadId)) throw new AppError(400, "Invalid lead id");
    if (!["new", "contacted", "closed"].includes(status)) {
      throw new AppError(400, "status must be new, contacted or closed");
    }
    const companyId = effectiveCompany(req, req.body.companyId);
    const lead = await Lead.findOneAndUpdate(
      { _id: leadId, ...(companyId ? { companyId } : {}) },
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