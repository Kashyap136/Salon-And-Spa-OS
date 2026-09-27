/**
 * Date helpers that use the browser's LOCAL calendar day.
 *
 * `new Date().toISOString().slice(0, 10)` returns the UTC day, which is the
 * previous/next calendar day for any user east/west of UTC between 00:00–05:30
 * or 19:00–24:00. The backend validates "today" with local server time, so a
 * UTC-derived value from an Indian salon (UTC+5:30) would silently default the
 * booking form to *yesterday* for the first half of every morning and the
 * server would reject it as a past date.
 */

const pad = (n) => String(n).padStart(2, "0");

/** Local YYYY-MM-DD for the current day. */
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local YYYY-MM for the current month (matches <input type="month">). */
export function currentMonthStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Local YYYY-MM-DD, `days` from today. Negative values look backwards. */
export function addDaysStr(days, now = new Date()) {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

/** True when an ISO date string is before today's local day. */
export function isBeforeToday(ymd, now = new Date()) {
  if (!ymd) return false;
  return ymd < todayStr(now);
}
