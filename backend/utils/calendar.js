const Booking = require("../models/Booking");
const { isRealMonth, localYM, AppError } = require("./helpers");

/**
 * Calendar data grouped by date (YYYY-MM-DD).
 * Returns { byDate: { "2026-05-13": [booking, ...] }, total }.
 * Shared by /api/bookings/calendar and /api/calendar.
 *
 * Always mounted behind authRequired, so the tenant comes from the JWT.
 */
async function calendarHandler(req, res, next) {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      return res.status(401).json({ msg: "Authentication required" });
    }

    // A month is required: without it the endpoint would load every booking the
    // salon has ever made.
    const month = req.query.month || localYM();
    if (!isRealMonth(month)) {
      throw new AppError(400, "month must be in YYYY-MM format");
    }

    const bookings = await Booking.find({ companyId, bookingDate: { $regex: `^${month}` } })
      .sort({ bookingDate: 1, slot: 1 })
      .limit(2000);
    const byDate = {};
    for (const b of bookings) {
      const key = b.bookingDate;
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(b);
    }
    res.json({ byDate, total: bookings.length });
  } catch (err) {
    next(err);
  }
}

module.exports = { calendarHandler };