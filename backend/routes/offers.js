const express = require("express");
const Offer = require("../models/Offer");
const Service = require("../models/Service");
const { authRequired, authOptional } = require("../middleware/auth");
const { effectiveCompany, toBool, toNumber, isValidObjectId, AppError, isYMD } = require("../utils/helpers");

const router = express.Router();

/** Normalize a date-only string to a JS Date at the start/end of that local day. */
function parseDate(value, endOfDay) {
  if (!value) return null;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00";
  if (isYMD(value)) return new Date(`${value}${suffix}`);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// POST /api/offers/create
router.post("/create", authRequired, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.code || b.discountValue === undefined || b.discountValue === null || b.discountValue === "") {
      return res.status(400).json({ msg: "code and discountValue are required" });
    }
    if (b.discountType && !["percent", "flat"].includes(b.discountType)) {
      return res.status(400).json({ msg: "discountType must be percent or flat" });
    }

    const code = String(b.code).trim().toUpperCase();
    const dup = await Offer.findOne({ companyId: req.companyId, code });
    if (dup) return res.status(409).json({ msg: "An offer with this code already exists" });

    const offer = await Offer.create({
      companyId: req.companyId,
      code,
      title: b.title || "",
      discountType: b.discountType === "flat" ? "flat" : "percent",
      discountValue: toNumber(b.discountValue),
      minOrderAmount: toNumber(b.minOrderAmount),
      maxDiscount: toNumber(b.maxDiscount),
      applicableServices: (b.applicableServices || []).filter(isValidObjectId),
      applicablePackages: (b.applicablePackages || []).filter(isValidObjectId),
      usageLimit: toNumber(b.usageLimit),
      usedCount: 0,
      validFrom: parseDate(b.validFrom, false),
      validUntil: parseDate(b.validUntil, true),
      isActive: b.isActive === undefined ? true : toBool(b.isActive),
    });

    res.status(201).json(offer);
  } catch (err) {
    next(err);
  }
});

// GET /api/offers/list?companyId=&isActive=true
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const filter = { companyId };
    if (req.query.isActive !== undefined) filter.isActive = toBool(req.query.isActive);

    const offers = await Offer.find(filter).sort({ createdAt: -1 });
    res.json(offers);
  } catch (err) {
    next(err);
  }
});

// POST /api/offers/validate — { code, serviceId, total }
// Company is resolved from the JWT when present; otherwise from the service.
router.post("/validate", authOptional, async (req, res, next) => {
  try {
    const { code, serviceId, total } = req.body;
    if (!code) throw new AppError(400, "Offer code is required");
    if (total === undefined || total === null || total === "") {
      throw new AppError(400, "total is required");
    }

    let companyId = req.companyId;
    if (!companyId) {
      if (!isValidObjectId(serviceId)) throw new AppError(400, "serviceId is required");
      const service = await Service.findById(serviceId);
      if (!service) throw new AppError(404, "Service not found");
      companyId = service.companyId.toString();
    }

    const offer = await Offer.findOne({ companyId, code: String(code).trim().toUpperCase() });
    if (!offer) throw new AppError(404, "Invalid offer code");

    const now = new Date();
    if (!offer.isActive) throw new AppError(400, "This offer is no longer active");
    if (offer.validFrom && new Date(offer.validFrom) > now) throw new AppError(400, "This offer is not valid yet");
    if (offer.validUntil && new Date(offer.validUntil) < now) throw new AppError(400, "This offer has expired");
    if (offer.usageLimit > 0 && offer.usedCount >= offer.usageLimit) {
      throw new AppError(400, "This offer is fully used");
    }
    if (offer.minOrderAmount > 0 && total < offer.minOrderAmount) {
      throw new AppError(400, `Minimum order for this offer is ₹${offer.minOrderAmount}`);
    }
    if (
      offer.applicableServices &&
      offer.applicableServices.length > 0 &&
      !offer.applicableServices.map(String).includes(String(serviceId))
    ) {
      throw new AppError(400, "This offer is not applicable to the selected service");
    }

    let discount;
    if (offer.discountType === "percent") {
      discount = Math.round((Number(total) * offer.discountValue) / 100);
      if (offer.maxDiscount > 0 && discount > offer.maxDiscount) discount = offer.maxDiscount;
    } else {
      discount = offer.discountValue;
    }

    res.json({ valid: true, discount, offerId: offer._id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;