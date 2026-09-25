const express = require("express");
const Package = require("../models/Package");
const Company = require("../models/Company");
const Service = require("../models/Service");
const { authRequired, authOptional } = require("../middleware/auth");
const { effectiveCompany, isValidObjectId, toNumber, AppError } = require("../utils/helpers");

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
    const owned = await Service.countDocuments({ _id: { $in: ids }, companyId: req.companyId });
    if (owned !== ids.length) {
      throw new AppError(403, "One or more services do not belong to this salon");
    }

    const price = toNumber(b.price);
    const originalPrice = toNumber(b.originalPrice);
    const pkg = await Package.create({
      companyId: req.companyId,
      name: String(b.name).trim(),
      description: b.description || "",
      services: b.services.map((s) => ({ serviceId: s.serviceId, qty: toNumber(s.qty) || 1 })),
      price,
      originalPrice,
      savings: Math.max(originalPrice - price, 0),
      validityDays: toNumber(b.validityDays) || 30,
      imageUrl: b.imageUrl || "",
    });

    res.status(201).json(pkg);
  } catch (err) {
    next(err);
  }
});

// GET /api/packages/list?companyId=
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);
    const packages = await Package.find({ companyId }).populate("services.serviceId").sort({ createdAt: -1 });
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
      .populate("services.serviceId")
      .sort({ createdAt: -1 });
    res.json({ company, packages });
  } catch (err) {
    next(err);
  }
});

module.exports = router;