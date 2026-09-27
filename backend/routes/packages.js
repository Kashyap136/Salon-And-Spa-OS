const express = require("express");
const Package = require("../models/Package");
const Company = require("../models/Company");
const Service = require("../models/Service");
const { authRequired } = require("../middleware/auth");
const { publicCompany } = require("../utils/serializers");
const { isValidObjectId, toNumber, AppError } = require("../utils/helpers");

const router = express.Router();

// POST /api/packages/create — { name, services: [{serviceId, qty}], price, originalPrice, validityDays }
router.post("/create", authRequired, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || b.price === undefined || b.price === null || b.originalPrice === undefined) {
      return res.status(400).json({ msg: "name, price and originalPrice are required" });
    }
    if (!Array.isArray(b.services) || b.services.length === 0) {
      return res.status(400).json({ msg: "At least one service is required" });
    }

    // Validate every service belongs to this company.
    const ids = b.services.map((s) => s && s.serviceId).filter(isValidObjectId);
    if (ids.length !== b.services.length) {
      return res.status(400).json({ msg: "Invalid service reference" });
    }
    if (b.services.length > 20) {
      return res.status(400).json({ msg: "A package can contain at most 20 services" });
    }
    // Quantities must be whole: a fractional qty would hand out an extra
    // redemption when a membership consumes it.
    for (const s of b.services) {
      const qty = toNumber(s.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return res.status(400).json({ msg: "Each service qty must be a whole number between 1 and 99" });
      }
    }
    const owned = await Service.countDocuments({ _id: { $in: ids }, companyId: req.companyId });
    if (owned !== ids.length) {
      throw new AppError(403, "One or more services do not belong to this salon");
    }

    const price = toNumber(b.price);
    const originalPrice = toNumber(b.originalPrice);
    if (price < 0 || originalPrice < 0) {
      return res.status(400).json({ msg: "Package prices cannot be negative" });
    }
    const validityDays = toNumber(b.validityDays) || 30;
    if (validityDays < 1 || validityDays > 3650) {
      return res.status(400).json({ msg: "validityDays must be between 1 and 3650" });
    }
    const pkg = await Package.create({
      companyId: req.companyId,
      name: String(b.name).trim().slice(0, 120),
      description: b.description || "",
      services: b.services.map((s) => ({ serviceId: s.serviceId, qty: toNumber(s.qty) })),
      price,
      originalPrice,
      savings: Math.max(originalPrice - price, 0),
      validityDays,
      imageUrl: b.imageUrl || "",
    });

    res.status(201).json(pkg);
  } catch (err) {
    next(err);
  }
});

// GET /api/packages/list — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const packages = await Package.find({ companyId: req.companyId })
      .populate({ path: "services.serviceId", match: { companyId: req.companyId } })
      .sort({ createdAt: -1 })
      .limit(300);
    res.json(packages);
  } catch (err) {
    next(err);
  }
});

// GET /api/packages/public?subdomain=mysalon — no auth.
router.get("/public", async (req, res, next) => {
  try {
    const company = await Company.findOne({
      subdomain: String(req.query.subdomain || "").toLowerCase().trim(),
    });
    if (!company) return res.status(404).json({ msg: "Salon not found" });

    const packages = await Package.find({ companyId: company._id, isActive: true })
      .populate({ path: "services.serviceId", match: { companyId: company._id } })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ company: publicCompany(company), packages });
  } catch (err) {
    next(err);
  }
});

module.exports = router;