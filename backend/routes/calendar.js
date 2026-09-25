const express = require("express");
const { calendarHandler } = require("../utils/calendar");

// GET /api/calendar?companyId=&month=YYYY-MM — alias of /api/bookings/calendar.
const router = express.Router();
router.get("/", calendarHandler);

module.exports = router;