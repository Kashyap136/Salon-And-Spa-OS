const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Staff",
    required: true,
    index: true,
  },
  esslId: { type: String, default: "" },
  // YYYY-MM-DD
  date: { type: String, required: true },
  inTime: { type: String, default: "" },
  outTime: { type: String, default: "" },
  status: { type: String, default: "present" },
  createdAt: { type: Date, default: Date.now },
});

// One record per staff per day from eSSL sync.
attendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);