const jwt = require("jsonwebtoken");
const Company = require("../models/Company");

const JWT_SECRET = () =>
  process.env.JWT_SECRET || "dev-secret-change-me-salon-spa-2026";

function signToken(companyId) {
  return jwt.sign({ companyId }, JWT_SECRET(), { expiresIn: "30d" });
}

/**
 * Required auth — protects salon-management APIs.
 * Rejects missing / invalid / malformed bearer tokens with 401.
 * Attaches req.companyId (company _id) and req.company (full document).
 */
async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return res.status(401).json({ msg: "Authentication required" });

    const payload = jwt.verify(token, JWT_SECRET());
    const company = await Company.findById(payload.companyId);
    if (!company) return res.status(401).json({ msg: "Invalid token — company not found" });

    req.companyId = company._id.toString();
    req.company = company;
    next();
  } catch {
    return res.status(401).json({ msg: "Invalid or expired token" });
  }
}

/**
 * Optional auth — used by listing endpoints that the public booking page
 * also calls (e.g. staff/list, offers/list). If a valid token is present,
 * req.companyId is set to the authenticated company so lists are scoped by
 * the server, never by an arbitrary query parameter.
 */
async function authOptional(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return next();

    const payload = jwt.verify(token, JWT_SECRET());
    const company = await Company.findById(payload.companyId);
    if (company) {
      req.companyId = company._id.toString();
      req.company = company;
    }
  } catch {
    // Invalid token — treat request as unauthenticated.
  }
  next();
}

module.exports = { authRequired, authOptional, signToken };