// 30-minute booking slots: 09:00-09:30 … 19:30-20:00 (matches the frontend).
const { minutesInTimezone } = require("./helpers");

const SLOTS = [];
for (let h = 9; h < 20; h++) {
  for (const m of [0, 30]) {
    const s = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const eH = m === 30 ? h + 1 : h;
    const eM = m === 30 ? 0 : 30;
    SLOTS.push(`${s}-${String(eH).padStart(2, "0")}:${String(eM).padStart(2, "0")}`);
  }
}

function isValidSlot(slot) {
  return SLOTS.includes(slot);
}

/**
 * Every 30-minute window a service occupies when it starts at `slot`.
 * A 30-minute service occupies exactly one window; a 45-minute service
 * occupies two, so a booking at 10:30 cannot overlap one started at 10:00.
 * Throws when the service would run past the last slot of the day.
 */
function occupiedSlotsFor(slot, durationMins = 30) {
  const idx = SLOTS.indexOf(slot);
  if (idx === -1) return [];
  const count = Math.max(1, Math.ceil((Number(durationMins) || 30) / 30));
  if (idx + count > SLOTS.length) {
    throw new Error("Service duration runs past the last available slot (20:00)");
  }
  return SLOTS.slice(idx, idx + count);
}

/**
 * True when a slot has been over long enough to be considered missed.
 *
 * `graceMins` matters: a customer whose slot ends at 17:30 is usually still in
 * the salon at 18:00, so the evening no-show job must not flip them to no-show
 * the moment the clock passes the slot's end time.
 *
 * The comparison runs in `timeZone` (the same zone the cron schedules in) so a
 * UTC host still judges "18:00 IST" rather than 18:00 UTC.
 */
function slotEndsBeforeNow(slot, now = new Date(), graceMins = 60, timeZone) {
  const end = String(slot).split("-")[1];
  if (!end) return true;
  const [hh, mm] = end.split(":").map(Number);
  const endMin = hh * 60 + mm;
  const nowMin = timeZone ? minutesInTimezone(now, timeZone) : now.getHours() * 60 + now.getMinutes();
  return endMin + (Number(graceMins) || 0) <= nowMin;
}

module.exports = { SLOTS, isValidSlot, occupiedSlotsFor, slotEndsBeforeNow };