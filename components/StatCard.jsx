"use client";

export default function StatCard({ label, value, sub, accent }) {
  return (
    <div className="ledger-panel p-5">
      <p className="text-xs uppercase tracking-wide text-ledger-creamDim mb-2" style={{ letterSpacing: "0.04em" }}>
        {label}
      </p>
      <p
        className="font-display text-4xl leading-none"
        style={{ color: accent || "#F3E9DE" }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-ledger-creamDim mt-2">{sub}</p>}
    </div>
  );
}
