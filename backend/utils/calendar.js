const Booking = require("../models/Booking");
const { effectiveCompany, isYM } = require("./helpers");

/**
 * Calendar data grouped by date (YYYY-MM-DD).
 * Returns { byDate: { "2026-05-13": [booking, ...] }, total }.
 * Shared by /api/bookings/calendar and /api/calendar.
 */
async function calendarHandler(req, res, next) {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) {
      return res.json({ byDate: {}, total: 0 });
    }

    const filter = { companyId };
    const month = req.query.month;
    if (isYM(month)) filter.bookingDate = { $regex: `^${month}` };

    const bookings = await Booking.find(filter).sort({ bookingDate: 1, slot: 1 });
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