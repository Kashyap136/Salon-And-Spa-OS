"use client";

const MAP = {
  booked: { bg: "rgba(214,162,75,0.18)", fg: "#E0BD7C", label: "Booked" },
  completed: { bg: "rgba(79,154,106,0.18)", fg: "#7FC79A", label: "Completed" },
  "no-show": { bg: "rgba(193,85,74,0.2)", fg: "#E08076", label: "No-show" },
  cancelled: { bg: "rgba(217,199,184,0.12)", fg: "#D9C7B8", label: "Cancelled" },
  paid: { bg: "rgba(79,154,106,0.18)", fg: "#7FC79A", label: "Paid" },
  pending: { bg: "rgba(214,162,75,0.18)", fg: "#E0BD7C", label: "Pending" },
  active: { bg: "rgba(79,154,106,0.18)", fg: "#7FC79A", label: "Active" },
  expired: { bg: "rgba(193,85,74,0.2)", fg: "#E08076", label: "Expired" },
  "in stock": { bg: "rgba(79,154,106,0.18)", fg: "#7FC79A", label: "In Stock" },
  "low stock": { bg: "rgba(193,85,74,0.2)", fg: "#E08076", label: "Low Stock" },
  valid: { bg: "rgba(79,154,106,0.18)", fg: "#7FC79A", label: "Valid" },
};

export default function StatusBadge({ status, label }) {
  const key = (status || "").toLowerCase();
  const cfg = MAP[key] || { bg: "rgba(217,199,184,0.12)", fg: "#D9C7B8", label: status };
  return (
    <span
      className="pill"
      style={{ background: cfg.bg, color: cfg.fg }}
    >
      {label || cfg.label}
    </span>
  );
}
