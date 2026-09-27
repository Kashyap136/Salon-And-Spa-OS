const express = require("express");
const mongoose = require("mongoose");
const Membership = require("../models/Membership");
const Package = require("../models/Package");
const { authRequired } = require("../middleware/auth");
const { isValidObjectId, AppError, isRealDate } = require("../utils/helpers");

const router = express.Router();

// POST /api/memberships/create — { customerName, phone, packageId, startDate }
router.post("/create", authRequired, async (req, res, next) => {
  try {
    const { customerName, phone, packageId, startDate } = req.body;
    if (!customerName || !phone || !isValidObjectId(packageId)) {
      return res.status(400).json({ msg: "customerName, phone and packageId are required" });
    }
    if (String(customerName).length > 120 || String(phone).length > 32) {
      return res.status(400).json({ msg: "customerName or phone is too long" });
    }
    if (startDate && !isRealDate(startDate)) {
      return res.status(400).json({ msg: "startDate must be a real date in YYYY-MM-DD format" });
    }

    const pkg = await Package.findOne({ _id: packageId, companyId: req.companyId });
    if (!pkg) throw new AppError(404, "Package not found for this salon");
    if (!pkg.isActive) throw new AppError(400, "This package is no longer available");

    const start = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
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

// GET /api/memberships/list?phone=&status=active — authenticated, company-scoped.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const filter = { companyId: req.companyId };
    if (req.query.phone) filter.phone = req.query.phone;
    if (req.query.status) filter.status = req.query.status;

    const memberships = await Membership.find(filter)
      .populate({
        path: "packageId",
        match: { companyId: req.companyId },
        populate: { path: "services.serviceId", match: { companyId: req.companyId } },
      })
      .sort({ createdAt: -1 })
      .limit(500);
    res.json(memberships);
  } catch (err) {
    next(err);
  }
});

// POST /api/memberships/use — { membershipId, serviceId }
// Consumes one service credit. The credit check and the append are a single
// atomic conditional update, so two concurrent "use" calls can never consume
// the same credit twice.
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
      match: { companyId: req.companyId },
      populate: { path: "services.serviceId", match: { companyId: req.companyId } },
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
    const serviceOid = new mongoose.Types.ObjectId(serviceId);

    // Atomic: only appends when this service still has an unconsumed credit.
    const updated = await Membership.findOneAndUpdate(
      {
        _id: membership._id,
        companyId: req.companyId,
        status: "active",
        endDate: { $gte: new Date() },
        $expr: {
          $lt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ["$servicesUsed", []] },
                  as: "u",
                  cond: { $eq: ["$$u.serviceId", serviceOid] },
                },
              },
            },
            allocated,
          ],
        },
      },
      [
        {
          $set: {
            servicesUsed: {
              $concatArrays: [
                { $ifNull: ["$servicesUsed", []] },
                [{ serviceId: serviceOid, usedDate: "$$NOW" }],
              ],
            },
          },
        },
        {
          $set: {
            // Fully consumed memberships expire immediately.
            status: {
              $cond: [
                {
                  $gte: [
                    { $size: { $ifNull: ["$servicesUsed", []] } },
                    { $ifNull: ["$servicesTotal", 0] },
                  ],
                },
                "expired",
                "$status",
              ],
            },
          },
        },
      ],
      { new: true }
    );

    if (!updated) {
      // Either the membership expired or this service's credits are spent.
      throw new AppError(400, "This service is already fully used in the membership");
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;