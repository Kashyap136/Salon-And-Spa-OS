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

/** Local YYYY-MM for a date. */
function localYM(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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
  toBool,
  effectiveCompany,
  localYMD,
  localYM,
  isYMD,
  isYM,
};