const express = require("express");
const Service = require("../models/Service");
const Company = require("../models/Company");
const { authRequired, authOptional } = require("../middleware/auth");
const { uploadServiceImage } = require("../middleware/upload");
const {
  effectiveCompany,
  toBool,
  toNumber,
  isValidObjectId,
} = require("../utils/helpers");

const router = express.Router();

const CATEGORIES = ["hair", "skin", "spa", "nails", "beard", "makeup"];
const GENDERS = ["M", "F", "U"];

// POST /api/services/create — multipart (auth required).
router.post("/create", authRequired, uploadServiceImage, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.category || b.price === undefined || b.price === null || b.price === "") {
      return res.status(400).json({ msg: "name, category and price are required" });
    }
    if (!CATEGORIES.includes(b.category)) {
      return res.status(400).json({ msg: "Invalid category" });
    }

    let comboServices = [];
    if (b.comboServices && String(b.comboServices).trim()) {
      let raw = b.comboServices;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = raw.split(",");
        }
      }
      comboServices = (Array.isArray(raw) ? raw : []).filter(isValidObjectId);
    }

    const service = await Service.create({
      companyId: req.companyId,
      name: String(b.name).trim(),
      category: b.category,
      durationMins: toNumber(b.durationMins) || 30,
      price: toNumber(b.price),
      gender: GENDERS.includes(b.gender) ? b.gender : "U",
      isCombo: toBool(b.isCombo),
      comboServices,
      imageUrl: req.file ? `/uploads/services/${req.file.filename}` : "",
    });

    res.status(201).json(service);
  } catch (err) {
    next(err);
  }
});

// GET /api/services/list?companyId=&category=&gender=
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const filter = { companyId };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.gender) filter.gender = req.query.gender;

    const services = await Service.find(filter)
      .populate("comboServices")
      .sort({ createdAt: -1 });
    res.json(services);
  } catch (err) {
    next(err);
  }
});

// GET /api/services/public?subdomain=mysalon — no auth.
router.get("/public", async (req, res, next) => {
  try {
    const company = await Company.findOne({
      subdomain: String(req.query.subdomain || "").toLowerCase().trim(),
    });
    if (!company) return res.status(404).json({ msg: "Salon not found" });

    const services = await Service.find({ companyId: company._id, isActive: true })
      .populate("comboServices")
      .sort({ createdAt: -1 });
    res.json({ company, services });
  } catch (err) {
    next(err);
  }
});

module.exports = router;