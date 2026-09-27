const express = require("express");
const Review = require("../models/Review");
const Booking = require("../models/Booking");
const { isValidObjectId, toNumber, AppError } = require("../utils/helpers");
const { publicCompany } = require("../utils/serializers");
const { rateLimit } = require("../utils/rateLimit");
const Company = require("../models/Company");

const router = express.Router();

// Reviews are anonymous; one per booking (unique index) and rate bounded.
const publicWriteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40 });

// POST /api/reviews/create — { bookingId, rating, comment }
// Public (guests review without an account) but constrained:
//   - the booking must exist and be completed
//   - one review per booking (enforced by a unique index)
// The tenant is derived from the booking, never from the request body.
router.post("/create", publicWriteLimiter, async (req, res, next) => {
  try {
    const { bookingId, rating, comment } = req.body;
    if (!isValidObjectId(bookingId)) throw new AppError(400, "Invalid booking id");
    const r = toNumber(rating);
    if (r < 1 || r > 5) throw new AppError(400, "rating must be between 1 and 5");
    if (String(comment || "").length > 1000) {
      throw new AppError(400, "comment is too long (1000 characters max)");
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) throw new AppError(404, "Booking not found");
    if (booking.status !== "completed") {
      throw new AppError(400, "You can only review a completed booking");
    }

    const review = await Review.create({
      companyId: booking.companyId,
      bookingId,
      customerName: booking.customerName,
      rating: r,
      comment: comment || "",
    });

    res.status(201).json(review);
  } catch (err) {
    if (err && err.code === 11000) {
      return next(new AppError(409, "This booking has already been reviewed"));
    }
    next(err);
  }
});

// GET /api/reviews/list?subdomain= (or ?companyId=) — public reviews + average.
// Reviews are public marketing data, so anonymous read is intentional. Resolve
// the tenant from subdomain OR companyId and return only public fields.
router.get("/list", async (req, res, next) => {
  try {
    let company = null;
    if (req.query.subdomain) {
      company = await Company.findOne({
        subdomain: String(req.query.subdomain).toLowerCase().trim(),
      });
    } else if (isValidObjectId(req.query.companyId)) {
      company = await Company.findById(req.query.companyId);
    }
    if (!company) return res.json({ reviews: [], average: 0, company: null });

    const reviews = await Review.find({ companyId: company._id })
      .select("customerName rating comment createdAt")
      .sort({ createdAt: -1 })
      .limit(50);
    // Average over every review, not just the page above.
    const [summary] = await Review.aggregate([
      { $match: { companyId: company._id } },
      { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    const average = summary ? Math.round(summary.average * 10) / 10 : 0;

    res.json({ reviews, average, total: summary ? summary.count : 0, company: publicCompany(company) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
