const mongoose = require("mongoose");

/** Custom error carrying an HTTP status code. */
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/** Coerce a (possibly string/FormData) value to a number. */
function toNumber(v) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round a monetary value to 2 decimal places (avoids float drift in totals). */
function round2(v) {
  return Math.round((toNumber(v) + Number.EPSILON) * 100) / 100;
}

/** Coerce a numeric field, returning null when absent or non-numeric. */
function parseNumber(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a (possibly string/FormData) value to a boolean. */
function toBool(v) {
  return v === true || v === "true" || v === "1" || v === "on";
}

/**
 * Prefer the authenticated company id (server-side isolation).
 * Falls back to a user-supplied companyId only for public/no-auth paths.
 */
function effectiveCompany(req, fallback) {
  if (req.companyId) return req.companyId;
  if (fallback && isValidObjectId(fallback)) return fallback.toString();
  return null;
}

/** Local YYYY-MM-DD for a date (server-local, no UTC drift). */
function localYMD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * YYYY-MM-DD for a date *in an explicit IANA timezone*.
 *
 * node-cron schedules each job in `process.env.TZ` (Asia/Kolkata by default),
 * so "the 8 AM job" fires at 08:00 salon time. Deriving the target date with
 * `localYMD()` instead used the *host's* timezone: on a UTC container the job
 * ran at 02:30 and looked up the wrong calendar day, sending tomorrow's
 * reminders a day early and expiring memberships against the wrong date.
 */
function ymdInTimezone(d = new Date(), timeZone = process.env.TZ || "Asia/Kolkata") {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    // An invalid TZ string must not take the whole job down.
    return localYMD(d);
  }
}

/** Minutes since midnight for a date in an explicit IANA timezone. */
function minutesInTimezone(d = new Date(), timeZone = process.env.TZ || "Asia/Kolkata") {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    return get("hour") % 24 * 60 + get("minute");
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
}

/** Local YYYY-MM for a date. */
function localYM(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Format-only regex is not enough: 2026-02-31 must not be accepted. */
function isRealDate(s) {
  if (!isYMD(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  return (
    probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
  );
}

function isRealMonth(s) {
  if (!isYM(s)) return false;
  const [y, m] = s.split("-").map(Number);
  return m >= 1 && m <= 12;
}

/** True when a YYYY-MM-DD string is earlier than today (server local time). */
function isPastYMD(s, now = new Date()) {
  return s < localYMD(now);
}

function isYMD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isYM(s) {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s);
}

module.exports = {
  AppError,
  isValidObjectId,
  toNumber,
  round2,
  parseNumber,
  toBool,
  effectiveCompany,
  localYMD,
  localYM,
  ymdInTimezone,
  minutesInTimezone,
  isYMD,
  isYM,
  isRealDate,
  isRealMonth,
  isPastYMD,
};