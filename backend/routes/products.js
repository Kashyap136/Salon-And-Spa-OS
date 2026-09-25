const express = require("express");
const Product = require("../models/Product");
const { authRequired, authOptional } = require("../middleware/auth");
const { uploadProductImages } = require("../middleware/upload");
const { effectiveCompany, toBool, toNumber } = require("../utils/helpers");

const router = express.Router();

// POST /api/products/create — multipart, images array (max 5).
router.post("/create", authRequired, uploadProductImages, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || b.price === undefined || b.price === null || b.price === "") {
      return res.status(400).json({ msg: "name and price are required" });
    }

    const images = (req.files || []).map((f) => `/uploads/products/${f.filename}`);

    const product = await Product.create({
      companyId: req.companyId,
      name: String(b.name).trim(),
      brand: b.brand || "",
      price: toNumber(b.price),
      gstPercent: toNumber(b.gstPercent) || 18,
      stock: toNumber(b.stock),
      minStock: toNumber(b.minStock) || 5,
      category: b.category || "retail",
      images,
    });

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// GET /api/products/list?companyId=&lowStock=true
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const base = { companyId };
    const query = toBool(req.query.lowStock)
      ? { ...base, $expr: { $lte: ["$stock", "$minStock"] } }
      : base;

    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    next(err);
  }
});

module.exports = router;