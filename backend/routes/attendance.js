const express = require("express");
const Company = require("../models/Company");
const Staff = require("../models/Staff");
const Attendance = require("../models/Attendance");
const { authRequired, authOptional } = require("../middleware/auth");
const { effectiveCompany, isValidObjectId, AppError, isYMD } = require("../utils/helpers");

const router = express.Router();

/**
 * POST /api/attendance/sync — eSSL biometric sync.
 * Body: { esslId, inTime, outTime, date, companyId? }
 * When the device can be identifiied with a companyId it is matched against that
 * salon's staff only (multi-tenant isolation). Without it, the lookup falls back
 * to a salon-wide unique eSSL id (single-salon deployments / legacy devices).
 */
router.post("/sync", async (req, res, next) => {
  try {
    const { esslId, inTime, outTime, date, companyId } = req.body;
    if (!esslId) throw new AppError(400, "esslId is required");
    if (!isYMD(date)) throw new AppError(400, "date must be in YYYY-MM-DD format");

    const staffQuery = { esslId: String(esslId).trim() };
    if (companyId && isValidObjectId(companyId)) staffQuery.companyId = companyId;

    const staff = await Staff.findOne(staffQuery);
    if (!staff) throw new AppError(404, "No staff member found with this eSSL id");

    // Cross-salon guard: if the eSSL id exists under more than one salon and no
    // companyId was supplied, refuse rather than attach data to a random salon.
    if (!staffQuery.companyId) {
      const anyOther = await Staff.findOne({
        esslId: staff.esslId,
        companyId: { $ne: staff.companyId },
      });
      if (anyOther) {
        throw new AppError(
          400,
          "This eSSL id exists in more than one salon — send companyId with the sync request"
        );
      }
    }

    // Upsert one attendance record per staff per day.
    const attendance = await Attendance.findOneAndUpdate(
      { staffId: staff._id, date },
      {
        $set: {
          companyId: staff.companyId,
          esslId: String(esslId).trim(),
          inTime: inTime || "",
          outTime: outTime || "",
          status: "present",
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Salary-slip workflow hook: log the sync (real payroll exports happen offline).
    console.log(
      `[attendance] essl=${esslId} staff=${staff.name} date=${date} in=${inTime} out=${outTime} synced`
    );

    res.json({ msg: "Attendance synced", attendance });
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance/list?companyId=&date= — optional auth, company scoped.
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json([]);

    const filter = { companyId };
    if (req.query.date) filter.date = req.query.date;

    const records = await Attendance.find(filter)
      .populate("staffId", "name esslId")
      .sort({ date: -1 });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

module.exports = router;