const express = require("express");
const Offer = require("../models/Offer");
const Service = require("../models/Service");
const Package = require("../models/Package");
const { authRequired, authOptional } = require("../middleware/auth");
const { publicOffer } = require("../utils/serializers");
const { toBool, toNumber, isValidObjectId, AppError, isYMD, round2 } = require("../utils/helpers");

const router = express.Router();

/**
 * Normalize a date-only string to a JS Date at the start/end of that local day.
 *
 * A format-only match is not enough: `2026-02-31` passes an isYMD regex but is
 * not a real day, and `new Date("2026-02-31T00:00:00")` is an Invalid Date. That
 * used to be stored as null, silently turning a "expires in March" coupon into
 * an unbounded one. Every path now rejects an unresolvable value.
 */
function parseDate(value, endOfDay, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new AppError(400, `${field} must be a date string`);
  }
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00";
  let d;
  if (isYMD(value)) {
    // Round-trip the parts: Date silently rolls 2026-02-31 over to March 3.
    const [y, m, day] = value.split("-").map(Number);
    d = new Date(y, m - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== day) {
      throw new AppError(400, `${field} is not a real date (e.g. 2026-02-31 does not exist)`);
    }
    return d;
  }
  d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, `${field} is not a valid date`);
  }
  return d;
}

/**
 * Coerce an optional id-list field into an array of valid ObjectIds.
 * A non-array (a bare string or object) previously reached `.filter()` and threw
 * a TypeError, turning a bad request into a 500.
 */
function idList(value, field) {
  if (value === undefined || value === null || value === "") return [];
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed.split(",");
      }
    } else {
      raw = trimmed.split(",");
    }
  }
  if (!Array.isArray(raw)) {
    throw new AppError(400, `${field} must be an array of ids`);
  }
  if (raw.length > 200) {
    throw new AppError(400, `${field} cannot contain more than 200 ids`);
  }
  return raw.map((v) => String(v).trim()).filter(isValidObjectId);
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

    const discountValue = toNumber(b.discountValue);
    if (discountValue < 0) return res.status(400).json({ msg: "discountValue cannot be negative" });
    if (b.discountType === "percent" && discountValue > 100) {
      return res.status(400).json({ msg: "percent discountValue cannot exceed 100" });
    }
    if (toNumber(b.usageLimit) < 0 || toNumber(b.maxDiscount) < 0) {
      return res.status(400).json({ msg: "usageLimit and maxDiscount cannot be negative" });
    }
    const validFrom = parseDate(b.validFrom, false, "validFrom");
    const validUntil = parseDate(b.validUntil, true, "validUntil");
    if (validFrom && validUntil && validUntil < validFrom) {
      return res.status(400).json({ msg: "validUntil must be after validFrom" });
    }

    // Every referenced service/package must belong to this salon.
    const svcIds = idList(b.applicableServices, "applicableServices");
    const pkgIds = idList(b.applicablePackages, "applicablePackages");
    if (svcIds.length) {
      const owned = await Service.countDocuments({ _id: { $in: svcIds }, companyId: req.companyId });
      if (owned !== svcIds.length) throw new AppError(403, "One or more services do not belong to this salon");
    }
    if (pkgIds.length) {
      const owned = await Package.countDocuments({ _id: { $in: pkgIds }, companyId: req.companyId });
      if (owned !== pkgIds.length) throw new AppError(403, "One or more packages do not belong to this salon");
    }

    const offer = await Offer.create({
      companyId: req.companyId,
      code,
      title: (b.title || "").slice(0, 120),
      discountType: b.discountType === "flat" ? "flat" : "percent",
      discountValue,
      minOrderAmount: toNumber(b.minOrderAmount),
      maxDiscount: toNumber(b.maxDiscount),
      applicableServices: svcIds,
      applicablePackages: pkgIds,
      usageLimit: toNumber(b.usageLimit),
      usedCount: 0,
      validFrom,
      validUntil,
      isActive: b.isActive === undefined ? true : toBool(b.isActive),
    });

    res.status(201).json(offer);
  } catch (err) {
    next(err);
  }
});

// GET /api/offers/list?isActive=true — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const filter = { companyId: req.companyId };
    if (req.query.isActive !== undefined) filter.isActive = toBool(req.query.isActive);

    const offers = await Offer.find(filter).sort({ createdAt: -1 }).limit(300);
    res.json(offers);
  } catch (err) {
    next(err);
  }
});

/**
 * The validity window every *readable* offer surface must apply.
 *
 * `isActive` alone is not enough: it is flipped by a 09:15 cron, so between
 * midnight and that job an expired coupon was still listed to the public and
 * still accepted by the UI as "valid" until the booking was rejected.
 */
function currentlyValid(now = new Date()) {
  return {
    isActive: true,
    $and: [
      { $or: [{ validFrom: null }, { validFrom: { $exists: false } }, { validFrom: { $lte: now } }] },
      { $or: [{ validUntil: null }, { validUntil: { $exists: false } }, { validUntil: { $gte: now } }] },
    ],
  };
}

/** GET /api/offers/public?companyId=... — no auth. Valid offers only, with a
 * public projection (no usage counters / limits). */
router.get("/public", async (req, res, next) => {
  try {
    const companyId = String(req.query.companyId || "").trim();
    if (!isValidObjectId(companyId)) return res.status(400).json({ msg: "companyId is required" });
    const offers = await Offer.find({ companyId, ...currentlyValid() })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ offers: offers.map(publicOffer) });
  } catch (err) {
    next(err);
  }
});

// POST /api/offers/validate — { code, serviceId, total, isPackage?, packageId? }
// Company is resolved from the JWT when present; otherwise from the service.
// This must mirror createBookingCore's offer rules exactly: a preview that says
// "valid" for an offer the booking will reject is worse than no preview.
router.post("/validate", authOptional, async (req, res, next) => {
  try {
    const { code, serviceId, isPackage, packageId } = req.body;
    const total = round2(toNumber(req.body.total));
    if (!code) throw new AppError(400, "Offer code is required");
    if (req.body.total === undefined || req.body.total === null || req.body.total === "") {
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

    // Package applicability — previously omitted entirely, so an offer scoped
    // to packages reported "valid" for a plain service booking and was then
    // rejected at submit time.
    const wantsPackage = toBool(isPackage);
    if (offer.applicablePackages && offer.applicablePackages.length > 0) {
      if (!wantsPackage) {
        throw new AppError(400, "This offer is only valid on package bookings");
      }
      if (!isValidObjectId(packageId)) {
        throw new AppError(400, "packageId is required to validate a package offer");
      }
      const pkg = await Package.findOne({ _id: packageId, companyId });
      if (!pkg) throw new AppError(404, "Package not found for this salon");
      if (!pkg.isActive) throw new AppError(400, "This package is no longer available");
      if (!offer.applicablePackages.map(String).includes(String(pkg._id))) {
        throw new AppError(400, "This offer is not applicable to the selected package");
      }
    }

    let discount;
    if (offer.discountType === "percent") {
      discount = round2((total * offer.discountValue) / 100);
      if (offer.maxDiscount > 0 && discount > offer.maxDiscount) discount = offer.maxDiscount;
    } else {
      discount = round2(offer.discountValue);
    }
    // A discount can never exceed the order total.
    discount = Math.min(Math.max(discount, 0), total);

    res.json({ valid: true, discount, offerId: offer._id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;