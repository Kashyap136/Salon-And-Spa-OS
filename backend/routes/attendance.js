const express = require("express");
const crypto = require("crypto");
const Company = require("../models/Company");
const Staff = require("../models/Staff");
const Attendance = require("../models/Attendance");
const { authRequired, authOptional } = require("../middleware/auth");
const { isValidObjectId, AppError, isRealDate, toNumber } = require("../utils/helpers");
const { rateLimit } = require("../utils/rateLimit");

const router = express.Router();

/**
 * eSSL biometric device → attendance.
 *
 * The device is a separate hardware box with no user session, so it
 * authenticates with a shared secret sent as `x-attendance-key` (header) or
 * `attendanceKey` (body).
 *
 * Authentication is fail-closed, never fail-open. When ATTENDANCE_API_KEY is
 * NOT configured the endpoint is not anonymous: a signed-in staff session
 * (owner JWT) is required instead. The previous behaviour — skip the check
 * entirely when the env var was absent — let anyone on the internet write
 * attendance (salary/PII) for any salon whose sequential eSSL ids they could
 * guess. A deployment that wants device syncs must set ATTENDANCE_API_KEY.
 *
 * Always THROWS on failure (never returns an error object) so a caller cannot
 * silently ignore the rejection.
 */
function requireDeviceKey(req) {
  const configured = process.env.ATTENDANCE_API_KEY;

  const provided =
    req.headers["x-attendance-key"] || (req.body && req.body.attendanceKey) || "";

  if (configured) {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(configured));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) throw new AppError(401, "Invalid attendance device key");
    return;
  }

  // No device key configured: only an authenticated session may sync, and it is
  // pinned to that session's tenant.
  if (!req.companyId) {
    throw new AppError(
      503,
      "Attendance sync is not configured. Set ATTENDANCE_API_KEY for device syncs, or sign in."
    );
  }
}

const deviceLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });

/**
 * POST /api/attendance/sync — eSSL biometric sync.
 * Body: { esslId, inTime, outTime, date, companyId? }
 * Auth: the device shared key (ATTENDANCE_API_KEY) when configured, otherwise a
 * signed-in owner session. A body companyId is only honoured for device-key
 * calls; with a session the tenant always comes from the JWT.
 */
router.post("/sync", deviceLimiter, authOptional, async (req, res, next) => {
  try {
    requireDeviceKey(req);
    // With a session (no device key) the tenant is the JWT's, never the body's.
    const scopedCompanyId = req.companyId || req.body.companyId;

    const { esslId, inTime, outTime, date } = req.body;
    if (!esslId) throw new AppError(400, "esslId is required");
    if (!isRealDate(date)) {
      throw new AppError(400, "date must be a real date in YYYY-MM-DD format");
    }
    // Times must actually BE strings. Validating `String(value)` and then using
    // the original value let a JSON array (["09:00"]) through validation and then
    // crash workedHours() on .split() — a 500 from a malformed device payload.
    // Normalising here means everything downstream sees the same validated value.
    for (const [label, value] of [["inTime", inTime], ["outTime", outTime]]) {
      if (value === undefined || value === null || value === "") continue;
      if (typeof value !== "string") {
        throw new AppError(400, `${label} must be an HH:MM string`);
      }
      if (!/^\d{2}:\d{2}$/.test(value)) {
        throw new AppError(400, `${label} must be HH:MM`);
      }
      const [h, m] = value.split(":").map(Number);
      if (h > 23 || m > 59) throw new AppError(400, `${label} must be HH:MM`);
    }
    const cleanIn = typeof inTime === "string" ? inTime : "";
    const cleanOut = typeof outTime === "string" ? outTime : "";

    const staffQuery = { esslId: String(esslId).trim() };
    if (scopedCompanyId && isValidObjectId(scopedCompanyId)) {
      staffQuery.companyId = scopedCompanyId;
    } else if (scopedCompanyId) {
      throw new AppError(400, "Invalid companyId");
    }

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

    // Upsert one attendance record per staff per day. The companyId in the filter
    // makes an upsert impossible to attach to a different tenant's record.
    const attendance = await Attendance.findOneAndUpdate(
      { staffId: staff._id, companyId: staff.companyId, date },
      {
        $set: {
          esslId: String(esslId).trim(),
          inTime: cleanIn,
          outTime: cleanOut,
          status: "present",
          workedHours: workedHours(cleanIn, cleanOut),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Salary-slip workflow hook: log the sync (real payroll exports happen offline).
    console.log(
      `[attendance] staff=${staff.name} date=${date} in=${cleanIn || "-"} out=${cleanOut || "-"} synced`
    );

    res.json({ msg: "Attendance synced", attendance });
  } catch (err) {
    next(err);
  }
});

/** Hours between two HH:MM punches, clamped to 0..24 (payroll sanity). */
function workedHours(inTime, outTime) {
  if (!inTime || !outTime) return 0;
  const [ih, im] = inTime.split(":").map(Number);
  const [oh, om] = outTime.split(":").map(Number);
  const start = ih * 60 + im;
  const end = oh * 60 + om;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const mins = end >= start ? end - start : 24 * 60 - start + end; // overnight shift
  return toNumber((mins / 60).toFixed(2));
}

// GET /api/attendance/list?date= — authenticated, company-scoped.
// Attendance is salary/PII data: it must never be readable anonymously.
router.get("/list", authRequired, async (req, res, next) => {
  try {
    const filter = { companyId: req.companyId };
    if (req.query.date) {
      if (!isRealDate(req.query.date)) {
        throw new AppError(400, "date must be a real date in YYYY-MM-DD format");
      }
      filter.date = req.query.date;
    }

    const records = await Attendance.find(filter)
      // Attendance is salary/PII: pin the populated staff to this tenant so a
      // corrupt reference cannot expose another salon's staff name or device id.
      .populate({ path: "staffId", select: "name esslId", match: { companyId: req.companyId } })
      .sort({ date: -1 })
      .limit(500);
    res.json(records);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
