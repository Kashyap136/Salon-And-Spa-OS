const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

// Canonical extension per accepted content type. The stored filename uses this
// value rather than the client-supplied one, so a `.html`/`.svg`/`.php`
// originalname can never become an executable-looking file on disk.
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * Magic-byte signatures. A client controls the multipart `Content-Type`, so the
 * declared MIME proves nothing: the bytes on disk are what has to match.
 */
const SIGNATURES = [
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { mime: "image/gif", test: (b) => String.fromCharCode(b[0], b[1], b[2], b[3]) === "GIF8" },
  {
    mime: "image/webp",
    test: (b) =>
      String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP",
  },
];

function uploadedFiles(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  return files.filter(Boolean);
}

/** Delete files multer already wrote — used when the route later fails. */
function removeUploads(req) {
  for (const f of uploadedFiles(req)) {
    try {
      if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch (err) {
      console.error(`[upload] could not remove ${f.filename}: ${err.message}`);
    }
  }
}

/**
 * Runs after multer: verifies the stored bytes really are one of the accepted
 * image formats, so a renamed script (or an HTML/SVG polyglot) never survives
 * the upload even when it lies about its content type.
 */
function verifyImageBytes(req, res, next) {
  for (const file of uploadedFiles(req)) {
    let head;
    try {
      const fd = fs.openSync(file.path, "r");
      const buf = Buffer.alloc(12);
      fs.readSync(fd, buf, 0, 12, 0);
      fs.closeSync(fd);
      head = buf;
    } catch (err) {
      removeUploads(req);
      return res.status(400).json({ msg: `Could not read the uploaded file: ${err.message}` });
    }
    const known = SIGNATURES.some((s) => s.test(head));
    if (!known) {
      removeUploads(req);
      return res
        .status(400)
        .json({ msg: "That file is not a valid jpeg/png/webp/gif image" });
    }
  }
  next();
}

/**
 * Uploads are partitioned per tenant: `uploads/<folder>/<companyId>/<file>`.
 *
 * They are still served by the public static mount, because the public booking
 * page shows service images to anonymous visitors. So partitioning is a
 * defence-in-depth measure, not the access control: it guarantees two salons can
 * never collide on, overwrite or mis-attribute each other's files, and it makes
 * "delete everything this tenant uploaded" possible. Authorising staff and
 * product images would require proxying them through an authenticated route and
 * fetching them as blobs in the browser, because an <img> tag cannot carry the
 * bearer token.
 *
 * The directory and the URL stored on the record come from the same two helpers,
 * so they cannot drift apart.
 */
function uploadDir(req, folder) {
  const company = req && req.companyId;
  return company
    ? path.join(UPLOAD_ROOT, folder, String(company))
    : path.join(UPLOAD_ROOT, folder);
}

/** Public URL for a stored file, matching uploadDir() exactly. */
function uploadUrl(req, folder, file) {
  if (!file) return "";
  const company = req && req.companyId;
  const name = typeof file === "string" ? file : file.filename;
  return company ? `/uploads/${folder}/${company}/${name}` : `/uploads/${folder}/${name}`;
}

function makeUploader(folder, field, maxCount) {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      const dir = uploadDir(req, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = EXT_BY_MIME[file.mimetype] || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  });

  const handler = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: maxCount || 1 }, // 5 MB each
    fileFilter(req, file, cb) {
      if (Object.prototype.hasOwnProperty.call(EXT_BY_MIME, file.mimetype)) {
        return cb(null, true);
      }
      const err = new Error("Only jpeg/png/webp/gif images are allowed");
      err.status = 400;
      cb(err);
    },
  })[maxCount ? "array" : "single"](field, maxCount);

  return [handler, verifyImageBytes];
}

// Field "image" single file → uploads/services/
exports.uploadServiceImage = makeUploader("services", "image", 0);
// Field "photo" single file → uploads/staff/
exports.uploadStaffPhoto = makeUploader("staff", "photo", 0);
// Field "images" array, maximum 5 → uploads/products/
exports.uploadProductImages = makeUploader("products", "images", 5);
exports.removeUploads = removeUploads;
exports.uploadUrl = uploadUrl;
