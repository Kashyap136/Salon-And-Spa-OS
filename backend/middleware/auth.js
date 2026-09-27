const jwt = require("jsonwebtoken");
const Company = require("../models/Company");

/**
 * The JWT secret is a required secret. A built-in fallback would let anyone
 * who has read the source mint a valid owner token, so we refuse to sign or
 * verify with a hardcoded value. Startup validation lives in app.js.
 */
function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !String(secret).trim()) {
    throw new Error("JWT_SECRET is not configured — refusing to use an insecure fallback secret");
  }
  return secret;
}

const ALGORITHM = "HS256";

function signToken(companyId) {
  return jwt.sign({ companyId: String(companyId) }, jwtSecret(), {
    algorithm: ALGORITHM,
    expiresIn: "30d",
  });
}

function readBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Verify a bearer token and load the owning company.
 * Returns { companyId, company } or null when the token is unusable.
 * A database failure is thrown (not treated as an auth failure) so a Mongo
 * outage surfaces as 500/503 instead of silently logging every user out.
 */
async function resolveToken(req) {
  const token = readBearer(req);
  if (!token) return null;

  // Only JWT failures are auth failures.
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret(), { algorithms: [ALGORITHM] });
  } catch {
    return { invalid: true };
  }
  if (!payload || !payload.companyId) return { invalid: true };

  const company = await Company.findById(payload.companyId);
  if (!company) return { invalid: true };

  return { companyId: company._id.toString(), company };
}

/**
 * Required auth — protects salon-management APIs.
 * Rejects missing / invalid / malformed bearer tokens with 401.
 * Attaches req.companyId (company _id) and req.company (full document).
 */
async function authRequired(req, res, next) {
  try {
    const auth = await resolveToken(req);
    if (!auth) return res.status(401).json({ msg: "Authentication required" });
    if (auth.invalid) return res.status(401).json({ msg: "Invalid or expired token" });

    req.companyId = auth.companyId;
    req.company = auth.company;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth — used by genuinely public read endpoints (public catalogs,
 * reviews). No Authorization header at all means "anonymous" and is allowed.
 *
 * A header that is *present but invalid* is a 401 rather than a silent
 * downgrade to anonymous: otherwise an expired session would silently read
 * unauthenticated data instead of surfacing the auth failure.
 */
async function authOptional(req, res, next) {
  try {
    const auth = await resolveToken(req);
    if (auth && auth.invalid) {
      return res.status(401).json({ msg: "Invalid or expired token" });
    }
    if (auth) {
      req.companyId = auth.companyId;
      req.company = auth.company;
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authRequired, authOptional, signToken, jwtSecret };
