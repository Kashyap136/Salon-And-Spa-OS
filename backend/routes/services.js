const express = require("express");
const Service = require("../models/Service");
const Company = require("../models/Company");
const { authRequired } = require("../middleware/auth");
const { uploadServiceImage, removeUploads, uploadUrl } = require("../middleware/upload");
const { publicCompany } = require("../utils/serializers");
const { toBool, toNumber, isValidObjectId, AppError } = require("../utils/helpers");

const router = express.Router();

const CATEGORIES = ["hair", "skin", "spa", "nails", "beard", "makeup"];
const GENDERS = ["M", "F", "U"];

// POST /api/services/create — multipart (auth required).
//
// Every validation failure THROWS rather than returning a 400 inline. Multer has
// already written the image to disk by the time this handler runs, so an early
// `return res.status(400)` skipped the catch block that calls removeUploads() and
// left a publicly-served orphan image behind for a record that was never created.
// Throwing routes all exits through the single cleanup path.
router.post("/create", authRequired, uploadServiceImage, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || !b.category || b.price === undefined || b.price === null || b.price === "") {
      throw new AppError(400, "name, category and price are required");
    }
    if (!CATEGORIES.includes(b.category)) {
      throw new AppError(400, "Invalid category");
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
      if (comboServices.length > 20) {
        throw new AppError(400, "A combo can contain at most 20 services");
      }
      // Every referenced combo service must belong to this salon.
      if (comboServices.length) {
        const owned = await Service.countDocuments({
          _id: { $in: comboServices },
          companyId: req.companyId,
        });
        if (owned !== comboServices.length) {
          throw new AppError(403, "One or more combo services do not belong to this salon");
        }
      }
    }

    const durationMins = toNumber(b.durationMins) || 30;
    if (durationMins < 15 || durationMins > 480) {
      throw new AppError(400, "durationMins must be between 15 and 480");
    }
    const price = toNumber(b.price);
    if (price < 0) throw new AppError(400, "price cannot be negative");

    const service = await Service.create({
      companyId: req.companyId,
      name: String(b.name).trim().slice(0, 120),
      category: b.category,
      durationMins,
      price,
      gender: GENDERS.includes(b.gender) ? b.gender : "U",
      isCombo: toBool(b.isCombo),
      comboServices,
      imageUrl: req.file ? uploadUrl(req, "services", req.file) : "",
    });

    res.status(201).json(service);
  } catch (err) {
    // multer has already written the file to disk — do not leave an orphan
    // behind for a record that was never created.
    removeUploads(req);
    next(err);
  }
});

// GET /api/services/list?category=&gender= — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const filter = { companyId: req.companyId };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.gender) filter.gender = req.query.gender;

    const services = await Service.find(filter)
      .populate({ path: "comboServices", match: { companyId: req.companyId } })
      .sort({ createdAt: -1 })
      .limit(500);
    res.json(services);
  } catch (err) {
    next(err);
  }
});

// GET /api/services/public?subdomain=mysalon — no auth.
// Returns a public-safe company projection (never the password hash).
router.get("/public", async (req, res, next) => {
  try {
    const company = await Company.findOne({
      subdomain: String(req.query.subdomain || "").toLowerCase().trim(),
    });
    if (!company) return res.status(404).json({ msg: "Salon not found" });

    const services = await Service.find({ companyId: company._id, isActive: true })
      .populate({ path: "comboServices", match: { companyId: company._id } })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ company: publicCompany(company), services });
  } catch (err) {
    next(err);
  }
});

module.exports = router;