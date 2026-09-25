const express = require("express");
const Membership = require("../models/Membership");
const Package = require("../models/Package");
const { authRequired, authOptional } = require("../middleware/auth");
const { effectiveCompany, isValidObjectId, AppError, isYMD } = require("../utils/helpers");

const router = express.Router();

// POST /api/memberships/create — { customerName, phone, packageId, startDate }
router.post("/create", authRequired, async (req, res, next) => {
  try {
    const { customerName, phone, packageId, startDate } = req.body;
    if (!customerName || !phone || !isValidObjectId(packageId)) {
      return res.status(400).json({ msg: "customerName, phone and packageId are required" });
    }

    const pkg = await Package.findOne({ _id: packageId, companyId: req.companyId });
    if (!pkg) throw new AppError(404, "Package not found for this salon");

    const start = startDate && isYMD(startDate) ? new Date(`${startDate}T00:00:00`) : new Date();
    const validityDays = Math.max(1, Number(pkg.validityDays) || 30);
    const end = new Date(start);
    end.setDate(end.getDate() + validityDays);

    const servicesTotal = (pkg.services || []).reduce((sum, s) => sum + (s.qty || 1), 0);

    const membership = await Membership.create({
      companyId: req.companyId,
      customerName: String(customerName).trim(),
      phone,
      packageId,
      startDate: start,
      endDate: end,
      servicesUsed: [],
      servicesTotal,
      status: "active",
    });

    res.status(201).json(membership);
  } catch (err) {
    next(err);
  }
});

// GET /api/memberships/list?companyId=&phone=&status=active
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const filter = { companyId };
    if (req.query.phone) filter.phone = req.query.phone;
    if (req.query.status) filter.status = req.query.status;

    const memberships = await Membership.find(filter)
      .populate({ path: "packageId", populate: { path: "services.serviceId" } })
      .sort({ createdAt: -1 });
    res.json(memberships);
  } catch (err) {
    next(err);
  }
});

// POST /api/memberships/use — { membershipId, serviceId }
router.post("/use", authRequired, async (req, res, next) => {
  try {
    const { membershipId, serviceId } = req.body;
    if (!isValidObjectId(membershipId) || !isValidObjectId(serviceId)) {
      return res.status(400).json({ msg: "membershipId and serviceId are required" });
    }

    const membership = await Membership.findOne({
      _id: membershipId,
      companyId: req.companyId,
    }).populate({
      path: "packageId",
      populate: { path: "services.serviceId" },
    });
    if (!membership) throw new AppError(404, "Membership not found");

    if (membership.status !== "active") throw new AppError(400, "This membership is not active");
    if (new Date(membership.endDate) < new Date()) {
      membership.status = "expired";
      await membership.save();
      throw new AppError(400, "This membership has expired");
    }

    const pkg = membership.packageId;
    const line = (pkg.services || []).find(
      (s) => s.serviceId && String(s.serviceId._id || s.serviceId) === String(serviceId)
    );
    if (!line) throw new AppError(400, "This service is not part of the membership package");

    const allocated = line.qty || 1;
    const usedOfThis = (membership.servicesUsed || []).filter(
      (u) => String(u.serviceId) === String(serviceId)
    ).length;
    if (usedOfThis >= allocated) {
      throw new AppError(400, "This service is already fully used in the membership");
    }

    membership.servicesUsed.push({ serviceId, usedDate: new Date() });
    if ((membership.servicesUsed?.length || 0) >= (membership.servicesTotal || 0)) {
      membership.status = "expired";
    }
    await membership.save();

    res.json(membership);
  } catch (err) {
    next(err);
  }
});

module.exports = router;