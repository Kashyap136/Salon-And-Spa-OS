const express = require("express");
const { authRequired } = require("../middleware/auth");
const { calendarHandler } = require("../utils/calendar");

const router = express.Router();

// GET /api/calendar?month=YYYY-MM — alias of /api/bookings/calendar.
// Authenticated and company-scoped: the calendar exposes every booking
// (customer name, phone, service, staff) and must never be readable
// anonymously by guessing a companyId.
router.get("/", authRequired, calendarHandler);

module.exports = router;
