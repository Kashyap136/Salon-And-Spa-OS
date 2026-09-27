const express = require("express");
const Product = require("../models/Product");
const { authRequired } = require("../middleware/auth");
const { uploadProductImages, removeUploads, uploadUrl } = require("../middleware/upload");
const { toBool, toNumber, AppError } = require("../utils/helpers");

const router = express.Router();

// POST /api/products/create — multipart, images array (max 5).
//
// Validation failures THROW so they reach the catch block that calls
// removeUploads(); an inline `return res.status(400)` would leave the already-
// written images behind as publicly-served orphans.
router.post("/create", authRequired, uploadProductImages, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name || b.price === undefined || b.price === null || b.price === "") {
      throw new AppError(400, "name and price are required");
    }
    const price = toNumber(b.price);
    const stock = toNumber(b.stock);
    const minStock = toNumber(b.minStock) || 5;
    if (price < 0) throw new AppError(400, "price cannot be negative");
    if (stock < 0) throw new AppError(400, "stock cannot be negative");
    if (minStock < 0) throw new AppError(400, "minStock cannot be negative");

    const images = (req.files || []).map((f) => uploadUrl(req, "products", f));

    const product = await Product.create({
      companyId: req.companyId,
      name: String(b.name).trim().slice(0, 120),
      brand: b.brand || "",
      price,
      gstPercent: toNumber(b.gstPercent) || 18,
      stock,
      minStock,
      category: b.category || "retail",
      images,
    });

    res.status(201).json(product);
  } catch (err) {
    removeUploads(req);
    next(err);
  }
});

// GET /api/products/list?lowStock=true — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const base = { companyId: req.companyId };
    const query = toBool(req.query.lowStock)
      ? { ...base, $expr: { $lte: ["$stock", "$minStock"] } }
      : base;

    const products = await Product.find(query).sort({ createdAt: -1 }).limit(500);
    res.json(products);
  } catch (err) {
    next(err);
  }
});

module.exports = router;