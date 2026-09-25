// 30-minute booking slots: 09:00-09:30 … 19:30-20:00 (matches the frontend).
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

/** True when the slot's end time has already passed (for no-show detection). */
function slotEndsBeforeNow(slot, now = new Date()) {
  const end = String(slot).split("-")[1];
  if (!end) return true;
  const [hh, mm] = end.split(":").map(Number);
  const endMin = hh * 60 + mm;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return endMin <= nowMin;
}

module.exports = { SLOTS, isValidSlot, slotEndsBeforeNow };