/**
 * Offer usage accounting.
 *
 * `usedCount` is incremented when a booking is created, because that is the
 * moment the usage limit must be enforced. It has to be given back when that
 * booking stops consuming the promotion — otherwise a single customer can burn
 * a "first booking only" coupon by booking and then cancelling, and the nightly
 * no-show cron can exhaust a cap in bulk without a single real redemption.
 *
 * A completed booking keeps its count: the customer really did use the discount.
 */
const Offer = require("../models/Offer");

/**
 * Give back one use of an offer. Idempotent-safe and floor-clamped at 0, and
 * scoped to the tenant so a stale/cross-tenant id can never mutate another
 * salon's counter.
 *
 * Returns true when a counter was decremented.
 */
async function releaseOfferUsage(companyId, offerId) {
  if (!companyId || !offerId) return false;
  const res = await Offer.updateOne(
    // The `usedCount: { $gt: 0 }` guard is what clamps at zero: a double
    // release (e.g. cancel followed by a replayed no-show) is a no-op rather
    // than handing the offer free uses.
    { _id: offerId, companyId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } }
  );
  if (res.modifiedCount === 0) {
    console.warn(
      `[offers] could not release use of offer ${offerId} for company ${companyId} (already at zero or unknown id)`
    );
    return false;
  }
  return true;
}

module.exports = { releaseOfferUsage };
