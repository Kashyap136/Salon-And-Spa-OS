"use client";

export default function StatCard({ label, value, sub, accent }) {
  return (
    <div className="ledger-panel p-4 min-[420px]:p-5 min-w-0">
      <p className="text-xs uppercase tracking-wide text-ledger-creamDim mb-2 whitespace-normal overflow-wrap-anywhere" style={{ letterSpacing: "0.04em" }}>
        {label}
      </p>
      <p
        className="font-display text-xl sm:text-2xl md:text-4xl leading-none break-words overflow-wrap-anywhere"
        style={{ color: accent || "#F3E9DE" }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-ledger-creamDim mt-2 whitespace-normal overflow-wrap-anywhere">{sub}</p>}
    </div>
  );
}
