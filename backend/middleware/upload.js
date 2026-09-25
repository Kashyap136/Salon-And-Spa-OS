const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

function makeUploader(folder, field, maxCount) {
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(UPLOAD_ROOT, folder);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext || ".jpg"}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter(req, file, cb) {
      if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
      const err = new Error("Only jpeg/png/webp/gif images are allowed");
      err.status = 400;
      cb(err);
    },
  })[maxCount ? "array" : "single"](field, maxCount);
}

// Field "image" single file → uploads/services/
exports.uploadServiceImage = makeUploader("services", "image", 0);
// Field "photo" single file → uploads/staff/
exports.uploadStaffPhoto = makeUploader("staff", "photo", 0);
// Field "images" array, maximum 5 → uploads/products/
exports.uploadProductImages = makeUploader("products", "images", 5);