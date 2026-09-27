const express = require("express");
const Staff = require("../models/Staff");
const Company = require("../models/Company");
const { authRequired } = require("../middleware/auth");
const { uploadStaffPhoto, removeUploads, uploadUrl } = require("../middleware/upload");
const { publicStaff } = require("../utils/serializers");
const { toNumber, AppError } = require("../utils/helpers");

const router = express.Router();

const SPECIALIZATIONS = ["hair", "skin", "spa", "nails", "beard", "makeup"];

// POST /api/staff/create — multipart (auth required).
//
// Validation failures THROW so they travel through the catch block that calls
// removeUploads(); an inline `return res.status(400)` would leave the already-
// written photo behind as a publicly-served orphan.
router.post("/create", authRequired, uploadStaffPhoto, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name) throw new AppError(400, "name is required");

    const commissionPercent = toNumber(b.commissionPercent) || 10;
    if (commissionPercent < 0 || commissionPercent > 100) {
      throw new AppError(400, "commissionPercent must be between 0 and 100");
    }
    if (toNumber(b.experienceYears) < 0 || toNumber(b.salary) < 0) {
      throw new AppError(400, "experienceYears and salary cannot be negative");
    }

    const staff = await Staff.create({
      companyId: req.companyId,
      name: String(b.name).trim().slice(0, 120),
      phone: b.phone || "",
      specialization: SPECIALIZATIONS.includes(b.specialization) ? b.specialization : "hair",
      experienceYears: toNumber(b.experienceYears),
      salary: toNumber(b.salary),
      commissionPercent,
      // Leave unset (not "") so the tenant-scoped unique index below does not
      // collide on every staff member without a device id.
      esslId: b.esslId ? String(b.esslId).trim() : undefined,
      photoUrl: req.file ? uploadUrl(req, "staff", req.file) : "",
      status: "active",
    });

    res.status(201).json(staff);
  } catch (err) {
    removeUploads(req);
    if (err && err.code === 11000) {
      return next(new AppError(409, "Another staff member already uses this eSSL id"));
    }
    next(err);
  }
});

// GET /api/staff/list?specialization= — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const filter = { companyId: req.companyId };
    if (req.query.specialization) filter.specialization = req.query.specialization;

    const staff = await Staff.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json(staff);
  } catch (err) {
    next(err);
  }
});

// GET /api/staff/public?subdomain=mysalon — no auth.
// Public-safe projection: name/specialization/photo only (no salary,
// commission or eSSL id).
router.get("/public", async (req, res, next) => {
  try {
    const company = await Company.findOne({
      subdomain: String(req.query.subdomain || "").toLowerCase().trim(),
    });
    if (!company) return res.status(404).json({ msg: "Salon not found" });

    // Anonymous endpoint: capped so a request cannot pull an arbitrarily large
    // roster into memory. 200 is far beyond a real salon's public "meet the
    // team" page, and the full roster remains available to the owner on /list.
    const staff = await Staff.find({ companyId: company._id, status: "active" })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ staff: staff.map(publicStaff) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;