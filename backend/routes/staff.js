const express = require("express");
const Staff = require("../models/Staff");
const { authRequired, authOptional } = require("../middleware/auth");
const { uploadStaffPhoto } = require("../middleware/upload");
const { effectiveCompany, toNumber } = require("../utils/helpers");

const router = express.Router();

const SPECIALIZATIONS = ["hair", "skin", "spa", "nails", "makeup"];

// POST /api/staff/create — multipart (auth required).
router.post("/create", authRequired, uploadStaffPhoto, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name) return res.status(400).json({ msg: "name is required" });

    const staff = await Staff.create({
      companyId: req.companyId,
      name: String(b.name).trim(),
      phone: b.phone || "",
      specialization: SPECIALIZATIONS.includes(b.specialization) ? b.specialization : "hair",
      experienceYears: toNumber(b.experienceYears),
      salary: toNumber(b.salary),
      commissionPercent: toNumber(b.commissionPercent) || 10,
      esslId: b.esslId || "",
      photoUrl: req.file ? `/uploads/staff/${req.file.filename}` : "",
      status: "active",
    });

    res.status(201).json(staff);
  } catch (err) {
    next(err);
  }
});

// GET /api/staff/list?companyId=&specialization=hair
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const filter = { companyId };
    if (req.query.specialization) filter.specialization = req.query.specialization;

    const staff = await Staff.find(filter).sort({ createdAt: -1 });
    res.json(staff);
  } catch (err) {
    next(err);
  }
});

module.exports = router;