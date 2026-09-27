/**
 * Database bootstrap.
 *
 * Indexes are created explicitly (mongoose autoIndex is disabled in app.js) so
 * that a deployment either has the double-booking / one-invoice-per-booking
 * guarantees in place, or fails to start. Silently running without them would
 * mean the app "works" while allowing duplicate bookings — unacceptable.
 */
const Company = require("./models/Company");
const Service = require("./models/Service");
const Staff = require("./models/Staff");
const Package = require("./models/Package");
const Booking = require("./models/Booking");
const Offer = require("./models/Offer");
const Membership = require("./models/Membership");
const Product = require("./models/Product");
const Invoice = require("./models/Invoice");
const Attendance = require("./models/Attendance");
const Review = require("./models/Review");
const Lead = require("./models/Lead");
const PaymentOrder = require("./models/PaymentOrder");
const { occupiedSlotsFor } = require("./utils/slots");

const MODELS = [
  Company,
  Service,
  Staff,
  Package,
  Booking,
  Offer,
  Membership,
  Product,
  Invoice,
  Attendance,
  Review,
  Lead,
  PaymentOrder,
];

/**
 * Remove the pre-fix booking index.
 *
 * The old declaration used partialFilterExpression: { status: { $ne:
 * "cancelled" } }, which MongoDB rejects ($ne is not supported there), so the
 * intended uniqueness was never actually enforced. Where such an index *was*
 * created by some other path it must be dropped before the corrected one is
 * built.
 */
/**
 * Read the current indexes, treating a not-yet-created namespace as "none".
 * MongoDB raises NamespaceNotFound (code 26) on a fresh database because
 * `indexes()` is a read, not a create.
 */
async function safeIndexes() {
  try {
    return await Booking.collection.indexes();
  } catch (err) {
    if (err && (err.code === 26 || /ns does not exist/i.test(err.message || ""))) return [];
    throw err;
  }
}

async function dropLegacyBookingIndexes() {
  const indexes = await safeIndexes();
  const legacy = indexes.filter((ix) => {
    const key = ix.key || {};
    const fields = Object.keys(key);
    return (
      fields.length === 4 &&
      fields[0] === "companyId" &&
      fields[1] === "staffId" &&
      fields[2] === "bookingDate" &&
      fields[3] === "slot" &&
      ix.unique === true
    );
  });
  for (const ix of legacy) {
    await Booking.collection.dropIndex(ix.name);
    console.log(`[db] dropped unsupported legacy booking index "${ix.name}"`);
  }
}

/**
 * Backfill the duration-aware slot fields for bookings created before this
 * change: derive occupiedSlots from the stored slot **and the service duration**
 * and mark cancelled bookings as no longer holding their slot.
 *
 * Backfilling only the start window would be actively dangerous: a legacy
 * 90-minute treatment at 10:00 would occupy just 10:00-10:30, so the very next
 * 10:30 booking would be accepted by both the application check and the unique
 * index — the migration would manufacture the double-booking the index exists
 * to prevent.
 *
 * `occupiedSlots: []` is repaired too: an empty array holds nothing, so such a
 * row is invisible to the unique index and to the collision check.
 *
 * A stored array is NOT trusted, even when it is non-empty. An intermediate
 * deployment could have written only the start window for a longer service, and
 * such a row looks complete while still letting the next slot through. Every row
 * is therefore recomputed from the booking's own `serviceDurationMins` snapshot
 * and rewritten when it differs — the pass is idempotent (a correctly-migrated
 * row recomputes to the identical array) and reads through a cursor so a large
 * bookings table is never materialised in memory.
 */
async function backfillBookingSlots() {
  const ops = [];
  const unparsable = [];
  let scanned = 0;
  let rewritten = 0;
  let cursor = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await Booking.find(
      cursor ? { _id: { $gt: cursor } } : {}
    )
      .select("_id slot serviceDurationMins status occupiedSlots")
      .sort({ _id: 1 })
      .limit(500)
      .lean();

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]._id;
    scanned += batch.length;

    for (const b of batch) {
      const occupied = safeOccupiedSlots(b.slot, b.serviceDurationMins);

      if (!occupied.length) {
        // A slot we cannot parse, or a duration that runs past 20:00. Refuse to
        // guess: a wrong answer here is a double-booking.
        unparsable.push({ id: String(b._id), slot: b.slot, durationMins: b.serviceDurationMins });
        continue;
      }

      const activeSlot = b.status !== "cancelled";
      const slotsMatch =
        Array.isArray(b.occupiedSlots) &&
        b.occupiedSlots.length === occupied.length &&
        b.occupiedSlots.every((s, i) => s === occupied[i]);

      if (slotsMatch && b.activeSlot === activeSlot) continue;

      ops.push({
        updateOne: {
          filter: { _id: b._id },
          update: {
            $set: {
              occupiedSlots: occupied,
              activeSlot,
            },
          },
        },
      });

      if (ops.length >= 1000) {
        rewritten += ops.length;
        await Booking.bulkWrite(ops.splice(0, ops.length), { ordered: false });
      }
    }
  }

  if (ops.length) {
    rewritten += ops.length;
    await Booking.bulkWrite(ops, { ordered: false });
  }
  if (scanned) {
    console.log(
      `[db] verified duration-aware slot fields on ${scanned} booking(s); ` +
        `${rewritten} rewritten, ${unparsable.length} unresolvable`
    );
  }

  if (unparsable.length) {
    throw new Error(
      "Cannot enforce the double-booking index: existing bookings have an unparseable slot " +
        "or a duration that runs past 20:00, so their occupied windows cannot be derived. " +
        `Fix or cancel these bookings first: ${JSON.stringify(unparsable.slice(0, 5))}`
    );
  }
}

/** `occupiedSlotsFor` that degrades to `[]` instead of throwing. */
function safeOccupiedSlots(slot, durationMins) {
  try {
    return occupiedSlotsFor(slot, durationMins);
  } catch {
    return [];
  }
}

/**
 * Refuse to start when the data would violate the corrected unique index:
 * two active bookings sharing a staff/date/slot mean the database cannot
 * guarantee single-booking. An operator must resolve the collisions.
 */
async function assertNoSlotCollisions() {
  const collisions = await Booking.aggregate([
    { $match: { activeSlot: true, occupiedSlots: { $exists: true, $ne: [] } } },
    // Unwind so the check matches the multikey unique index exactly: any two
    // active bookings sharing a single 30-minute window collide.
    { $unwind: "$occupiedSlots" },
    {
      $group: {
        _id: {
          companyId: "$companyId",
          staffId: "$staffId",
          bookingDate: "$bookingDate",
          slot: "$occupiedSlots",
        },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 },
  ]);
  if (collisions.length) {
    throw new Error(
      "Cannot enforce the double-booking index: existing active bookings share a staff/date/slot. " +
        `First conflicts: ${JSON.stringify(collisions.map((c) => c._id))}`
    );
  }
}

/**
 * Staff used to default `esslId` to "" — with a tenant-scoped unique index that
 * would make every device-less staff member collide. Unset the empty values so
 * the partial unique index only applies to real device ids.
 */
async function normalizeStaffEsslIds() {
  const result = await Staff.updateMany(
    { $or: [{ esslId: "" }, { esslId: null }] },
    { $unset: { esslId: "" } }
  );
  if (result.modifiedCount > 0) {
    console.log(`[db] cleared empty eSSL ids on ${result.modifiedCount} staff member(s)`);
  }
}

async function initializeDatabase() {
  await dropLegacyBookingIndexes();
  await normalizeStaffEsslIds();
  await backfillBookingSlots();
  await assertNoSlotCollisions();
  // `Model.init()` is a no-op while autoIndex is off, so build explicitly.
  await Promise.all(MODELS.map((model) => model.createIndexes()));
}

module.exports = { initializeDatabase, MODELS };
