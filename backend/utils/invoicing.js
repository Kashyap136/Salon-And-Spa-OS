const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Service = require("../models/Service");
const Staff = require("../models/Staff");
const Booking = require("../models/Booking");
const { AppError, isValidObjectId, toNumber, round2 } = require("./helpers");
const crypto = require("crypto");

const GST_RATE = 0.18;

let invoiceCounter = Math.floor(Math.random() * 900) + 100;

/** A `completing` claim older than this is assumed to belong to a dead process. */
const STALE_CLAIM_MINUTES = 5;

/** INV-YYYY-XXXXXX with a process-level counter mixed in to avoid same-ms collisions. */
function nextInvoiceNo() {
  const year = new Date().getFullYear();
  invoiceCounter = (invoiceCounter + 1) % 1000;
  const seed = (Date.now() % 1000) * 1000 + invoiceCounter;
  return `INV-${year}-${String(seed % 1000000).padStart(6, "0")}`;
}

function staleClaimCutoff() {
  return new Date(Date.now() - STALE_CLAIM_MINUTES * 60 * 1000);
}

/**
 * Atomically claim a booking for completion.
 * Returns { mode: "claimed" } when this caller won the transition, or
 * { mode: "existing", invoice } when the booking was already completed.
 * The conditional update is the single source of truth for idempotency, so two
 * concurrent "complete" requests can never both run the side effects.
 *
 * A claim older than STALE_CLAIM_MINUTES is stolen: its process is gone, so
 * nobody is going to finish that completion. Without this, a crash between the
 * claim and the status flip left the appointment permanently unreachable — the
 * status route only accepts `status: "booked"`, so it could not be completed,
 * cancelled or marked no-show either.
 *
 * Each claim carries a fresh `completionToken`. Because a stale claim can be
 * stolen, `status: "completing"` alone does NOT prove ownership — the thief
 * holds a different claim. The token is a fencing token: every later update in
 * this attempt matches on it, so a worker that lost its lease cannot finalize or
 * release a booking another process is now invoicing. That closes the window
 * where a slow-but-alive first worker (e.g. a large product cart) returned after
 * a second worker had stolen its claim, and its catch-block reset a freshly
 * completed booking back to "booked" — leaving an invoice on a "booked" booking.
 */
async function claimBookingForCompletion(booking) {
  const token = crypto.randomUUID();
  const claimed = await Booking.findOneAndUpdate(
    {
      _id: booking._id,
      companyId: booking.companyId,
      $or: [
        { status: "booked" },
        // Stale in-flight claim from a process that died mid-completion.
        { status: "completing", completingAt: { $lte: staleClaimCutoff() } },
        // Legacy rows written before completingAt existed.
        { status: "completing", completingAt: null },
      ],
    },
    { $set: { status: "completing", completingAt: new Date(), completionToken: token } },
    { new: true }
  );
  if (claimed) return { mode: "claimed", token };

  const current = await Booking.findById(booking._id);
  if (!current) throw new AppError(404, "Booking not found");
  if (current.status === "completed") {
    const invoice = await Invoice.findOne({ companyId: current.companyId, bookingId: current._id });
    if (invoice) return { mode: "existing", invoice };
    throw new AppError(409, "Booking is already completed but its invoice is missing");
  }
  if (current.status === "completing") {
    throw new AppError(
      409,
      "This booking is already being completed — try again in a few minutes"
    );
  }
  throw new AppError(409, `Booking cannot be completed from status "${current.status}"`);
}

/**
 * Release `completing` claims whose process never came back.
 *
 * Called by the cron. In-process failures are already compensated by
 * completeBooking(); this only reaps claims left by a crash or an OOM kill, so
 * a booking can never be stranded mid-completion. Returns the ids released.
 */
async function reapStaleCompletionClaims() {
  // Batched so a wedged fleet cannot pull an unbounded number of bookings into
  // memory in one tick. Each batch is claimed and released independently.
  const released = [];
  const BATCH = 200;
  let cursor = null;

  do {
    const batch = await Booking.find({
      status: "completing",
      ...(cursor ? { _id: { $gt: cursor } } : {}),
      $or: [
        { completingAt: { $lte: staleClaimCutoff() } },
        { completingAt: null },
        { completingAt: { $exists: false } },
      ],
    })
      .select("_id")
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean();

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]._id;

    const res = await Booking.updateMany(
      { _id: { $in: batch.map((b) => b._id) }, status: "completing" },
      { $set: { status: "booked" }, $unset: { completingAt: "", completionToken: "" } }
    );
    if (res.modifiedCount) {
      released.push(...batch.map((b) => b._id));
      console.log(
        `[invoice] released ${res.modifiedCount} stale completion claim(s) older than ${STALE_CLAIM_MINUTES}m`
      );
    }
  } while (true);

  return released;
}

/**
 * Complete a booking: create the invoice (service item + optional retail
 * products), deduct product stock, compute GST, staff commission and grand
 * total, then flip the booking status to "completed".
 *
 * Idempotent — a repeated call returns the existing invoice without creating a
 * second one or deducting stock twice.
 *
 * ── Stock-compensation invariant (do not "simplify" this) ────────────────────
 * The invoice row is the commit record for the product deduction. Therefore:
 *   • failure BEFORE the invoice is written  → put the stock back, and the
 *     retry re-deducts from scratch;
 *   • failure AFTER the invoice is written   → LEAVE the deduction in place.
 *     Restoring it here and then skipping the deduction on retry (because the
 *     invoice already exists) is how stock ended up permanently over-counted
 *     while the invoice said the units were sold.
 * The only residual window is a hard process kill between the product decrement
 * and the invoice insert (a few milliseconds). Closing that needs a replica-set
 * transaction; see backend/README.md.
 */
async function completeBooking(booking, companyId, productsUsed = []) {
  const claim = await claimBookingForCompletion(booking);
  if (claim.mode === "existing") return claim.invoice;
  const token = claim.token;

  const restored = []; // stock we deducted in THIS attempt, to compensate on failure
  let invoiceCommitted = false; // did an invoice row for this booking exist when we gave up?

  try {
    // A previous attempt may have created the invoice and then failed to flip
    // the booking status. Because the claim is exclusive, checking here is safe.
    // The stock was deliberately left deducted by that attempt, so there is
    // nothing to re-apply here.
    const alreadyInvoiced = await Invoice.findOne({ companyId, bookingId: booking._id });
    if (alreadyInvoiced) {
      invoiceCommitted = true;
      const finished = await markCompleted(booking._id, token);
      if (!finished) {
        // The lease expired while we were checking. The invoice is committed, so
        // the correct answer is still the invoice — the worker holding the claim
        // now is responsible for the status flip. Do not force it.
        console.warn(
          `[invoice] lost the completion lease on booking ${booking._id}; the newer claim will finalise the status`
        );
      }
      return alreadyInvoiced;
    }

    const serviceDoc = await Service.findOne({ _id: booking.serviceId, companyId });
    const service = booking.serviceId && booking.serviceId.name ? booking.serviceId : serviceDoc;
    if (!service) throw new AppError(404, "Service not found for this booking");

    const staffDoc =
      booking.staffId && booking.staffId.commissionPercent !== undefined
        ? booking.staffId
        : await Staff.findOne({ _id: booking.staffId, companyId });
    // Prefer the booking-time snapshot so a later price edit cannot alter an
    // already-agreed invoice amount.
    const serviceTotal = round2(
      Number.isFinite(booking.servicePrice) && booking.servicePrice > 0
        ? booking.servicePrice
        : service.price
    );
    const items = [{ service: service._id, price: serviceTotal }];

    const productLines = [];
    let productsTotal = 0;

    if (Array.isArray(productsUsed)) {
      if (productsUsed.length > 50) {
        throw new AppError(400, "Too many product lines on one invoice");
      }
      for (const raw of productsUsed) {
        const line = raw && typeof raw === "object" ? raw : {};
        const pid = line.productId || line._id || raw;
        const rawQty = line.qty === undefined ? 1 : toNumber(line.qty);
        if (!isValidObjectId(pid)) {
          throw new AppError(400, "Each product line needs a valid productId");
        }
        if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 999) {
          throw new AppError(400, "Product qty must be a whole number between 1 and 999");
        }
        const qty = rawQty;

        // Conditional atomic decrement — two concurrent completions can never
        // drive stock negative.
        const product = await Product.findOneAndUpdate(
          { _id: pid, companyId, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true }
        );
        if (!product) {
          const missing = await Product.findOne({ _id: pid, companyId });
          if (!missing) throw new AppError(404, `Product ${pid} not found`);
          throw new AppError(400, `Insufficient stock for ${missing.name} (only ${missing.stock} left)`);
        }
        restored.push({ id: product._id, qty });

        const linePrice = round2(product.price * qty);
        productsTotal = round2(productsTotal + linePrice);
        productLines.push({ productId: product._id, qty, price: linePrice });
      }
    }

    const total = round2(serviceTotal + productsTotal);
    // Discount can never exceed the pre-tax subtotal.
    const discount = Math.min(round2(toNumber(booking.discountApplied)), total);
    const gstTotal = round2(total * GST_RATE);
    const grandTotal = Math.max(round2(total + gstTotal - discount), 0);
    const staffCommission = round2(
      (serviceTotal * (staffDoc && staffDoc.commissionPercent ? staffDoc.commissionPercent : 0)) / 100
    );

    let invoice = null;
    for (let attempt = 0; attempt < 5 && !invoice; attempt++) {
      try {
        invoice = await Invoice.create({
          companyId,
          bookingId: booking._id,
          customerName: booking.customerName,
          phone: booking.phone,
          items,
          products: productLines,
          offerDiscount: discount,
          total,
          gstTotal,
          discount,
          grandTotal,
          paymentMode: booking.paymentMode || "UPI",
          paymentStatus: "pending",
          invoiceNo: nextInvoiceNo(),
          staffCommission,
          // Snapshot of the advance already collected against this booking.
          // Without it the balance due cannot be computed: charging grandTotal
          // on top of a collected 20% advance overcharges every customer by 20%.
          advancePaid: round2(toNumber(booking.advancePaid)),
        });
      } catch (err) {
        if (err && err.code === 11000) {
          // Another writer invoiced this booking between our check and insert.
          // It moved its own stock, so give ours back rather than double-deduct.
          const existing = await Invoice.findOne({ companyId, bookingId: booking._id });
          if (existing) {
            for (const r of restored) {
              await Product.updateOne({ _id: r.id, companyId }, { $inc: { stock: r.qty } }).catch(() => {});
            }
            restored.length = 0;
            invoice = existing;
            break;
          }
          continue; // invoiceNo collision only — retry with a new number
        }
        throw err;
      }
    }
    if (!invoice) throw new AppError(500, "Could not generate a unique invoice number");
    invoiceCommitted = true;

    const finished = await markCompleted(booking._id, token);
    if (!finished) {
      // We lost the claim while invoicing (it went stale and another worker
      // stole it). The invoice and the stock deduction are committed, so they
      // must stand — but the status flip is the thief's to do, and forcing it
      // here would race that worker's own completion. Do not touch the status.
      throw new AppError(
        409,
        "This booking's completion lease expired while the invoice was being generated. " +
          "Retry to finalise it — the invoice is already recorded."
      );
    }

    return invoice;
  } catch (err) {
    if (invoiceCommitted) {
      // The invoice says these units were sold and the deduction is still in
      // place. Restoring the stock now would desynchronise the ledger from the
      // shelf, and the retry (which finds the invoice and skips re-deducting)
      // would never notice. Leave both alone and let the retry finish the flip.
      console.warn(
        `[invoice] completion failed after the invoice was written for booking ${booking._id}: ${err.message}`
      );
    } else {
      // No invoice was committed, so nothing records these units as sold —
      // put the stock back so the next attempt starts from the true count.
      for (const r of restored) {
        await Product.updateOne({ _id: r.id, companyId }, { $inc: { stock: r.qty } }).catch(() => {});
      }
    }

    // Release our claim — but ONLY if we still hold it. Matching on the token
    // is what stops a slow worker from resetting a booking that a newer worker
    // has since claimed and possibly already completed.
    await Booking.updateOne(
      { _id: booking._id, status: "completing", completionToken: token },
      { $set: { status: "booked" }, $unset: { completingAt: "", completionToken: "" } }
    ).catch(() => {});
    throw err;
  }
}

/**
 * Flip `completing` → `completed` and clear the claim, but only for the worker
 * holding `token`. Returns false when the claim was lost (stolen by a newer
 * worker, already reaped, or the booking moved on), in which case the caller
 * must not assume it owns the booking any more.
 */
async function markCompleted(bookingId, token) {
  const res = await Booking.updateOne(
    { _id: bookingId, status: "completing", completionToken: token },
    {
      $set: { status: "completed", completedAt: new Date() },
      $unset: { completingAt: "", completionToken: "" },
    }
  );
  return res.modifiedCount === 1;
}

module.exports = {
  completeBooking,
  nextInvoiceNo,
  reapStaleCompletionClaims,
  STALE_CLAIM_MINUTES,
  GST_RATE,
};
