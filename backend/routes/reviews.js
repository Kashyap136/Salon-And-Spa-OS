const express = require("express");
const Review = require("../models/Review");
const Booking = require("../models/Booking");
const { authOptional } = require("../middleware/auth");
const { effectiveCompany, isValidObjectId, toNumber, AppError } = require("../utils/helpers");

const router = express.Router();

// POST /api/reviews/create — { bookingId, rating, comment }
router.post("/create", async (req, res, next) => {
  try {
    const { bookingId, rating, comment } = req.body;
    if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");
    const r = toNumber(rating);
    if (r < 1 || r > 5) throw new AppError(400, "rating must be between 1 and 5");

    const booking = await Booking.findById(bookingId);
    if (!booking) throw new AppError(404, "Booking not found");

    const review = await Review.create({
      companyId: booking.companyId,
      bookingId,
      customerName: booking.customerName,
      rating: r,
      comment: comment || "",
    });

    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/list?companyId= — reviews + average rating.
router.get("/list", authOptional, async (req, res, next) => {
  try {
    const companyId = effectiveCompany(req, req.query.companyId);
    if (!companyId) return res.json({ reviews: [], average: 0 });

    const reviews = await Review.find({ companyId }).sort({ createdAt: -1 });
    const average = reviews.length
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : 0;

    res.json({ reviews, average });
  } catch (err) {
    next(err);
  }
});

module.exports = router;