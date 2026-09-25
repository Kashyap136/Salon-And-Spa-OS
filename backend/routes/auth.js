const express = require("express");
const bcrypt = require("bcryptjs");
const Company = require("../models/Company");
const { authRequired, signToken } = require("../middleware/auth");

const router = express.Router();

const SALON_TYPES = ["unisex", "men", "women", "spa"];
const LANGUAGES = ["Marathi", "Hindi", "English"];

// POST /api/auth/register — create a salon account.
router.post("/register", async (req, res, next) => {
  try {
    const { name, subdomain, ownerEmail, password, salonType, location } = req.body;

    if (!name || !subdomain || !ownerEmail || !password) {
      return res.status(400).json({ msg: "name, subdomain, ownerEmail and password are required" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ msg: "Password must be at least 6 characters" });
    }

    const sub = String(subdomain).toLowerCase().trim();
    if (!/^[a-z0-9-]+$/.test(sub)) {
      return res.status(400).json({ msg: "Subdomain may contain only letters, numbers and dashes" });
    }

    const exists = await Company.findOne({ subdomain: sub });
    if (exists) return res.status(409).json({ msg: "This subdomain is already taken" });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const company = await Company.create({
      name: String(name).trim(),
      subdomain: sub,
      ownerEmail: String(ownerEmail).toLowerCase().trim(),
      passwordHash,
      salonType: SALON_TYPES.includes(salonType) ? salonType : "unisex",
      location: location || "",
    });

    const token = signToken(company._id);
    res.status(201).json({
      token,
      companyId: company._id,
      subdomain: company.subdomain,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — sign in by subdomain + owner email.
router.post("/login", async (req, res, next) => {
  try {
    const { subdomain, email, password } = req.body;
    if (!subdomain || !email || !password) {
      return res.status(400).json({ msg: "subdomain, email and password are required" });
    }

    const company = await Company.findOne({
      subdomain: String(subdomain).toLowerCase().trim(),
      ownerEmail: String(email).toLowerCase().trim(),
    });
    if (!company) return res.status(401).json({ msg: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password), company.passwordHash);
    if (!ok) return res.status(401).json({ msg: "Invalid credentials" });

    const token = signToken(company._id);
    res.json({
      token,
      companyId: company._id,
      subdomain: company.subdomain,
      name: company.name,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/settings — current salon configuration (public-safe subset only,
// never returns the WhatsApp token or other secrets).
router.get("/settings", authRequired, async (req, res, next) => {
  try {
    const c = req.company;
    res.json({
      name: c.name,
      subdomain: c.subdomain,
      salonType: c.salonType,
      location: c.location,
      upiId: c.upiId,
      gstNo: c.gstNo,
      language: c.language,
      whatsappEnabled: c.whatsappEnabled,
      razorpayKey: c.razorpayKey,
      logoUrl: c.logoUrl,
      whatsappConfigured: Boolean(
        process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID
      ),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/settings — update salon configuration (language, UPI, keys...).
router.put("/settings", authRequired, async (req, res, next) => {
  try {
    const allowed = [
      "salonType",
      "location",
      "upiId",
      "gstNo",
      "language",
      "whatsappEnabled",
      "razorpayKey",
      "logoUrl",
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (patch.language && !LANGUAGES.includes(patch.language)) {
      return res.status(400).json({ msg: "language must be Marathi, Hindi or English" });
    }
    const company = await Company.findByIdAndUpdate(req.companyId, patch, {
      new: true,
      runValidators: true,
    });
    res.json({ msg: "Settings updated", company });
  } catch (err) {
    next(err);
  }
});

module.exports = router;