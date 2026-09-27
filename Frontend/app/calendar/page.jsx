"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, apiErrorMessage } from "@/lib/api";
import { currentMonthStr, todayStr } from "@/lib/date";
import Navbar from "@/components/Navbar";
import Alert from "@/components/Alert";

export default function CalendarPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [month, setMonth] = useState(currentMonthStr());
  const [byDate, setByDate] = useState({});
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get("/bookings/calendar", { params: { companyId, month } })
      .then((r) => { setByDate(r.data?.byDate || {}); setError(""); })
      .catch((err) => { setByDate({}); setError(apiErrorMessage(err, "Could not load the calendar.")); })
      .finally(() => setLoading(false));
  }, [month, companyId]);

  useEffect(() => {
    setSelected(null);
    load();
  }, [load]);

  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const todayISO = todayStr();

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function colorFor(count) {
    if (!count) return "transparent";
    if (count < 3) return "#4F9A6A";
    if (count < 6) return "#D6A24B";
    return "#C1554A";
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1200px] mx-auto py-8 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="page-title">Booking calendar</h1>
          <label className="inline-field text-xs">
            <span className="text-ledger-creamDim shrink-0">Month</span>
            <input
              type="month"
              aria-label="Calendar month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="text-sm min-w-0 max-w-full"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4 text-xs text-ledger-creamDim">
          <Legend color="#4F9A6A" label="Under 3" />
          <Legend color="#D6A24B" label="3–5" />
          <Legend color="#C1554A" label="Over 5" />
        </div>

        {error && <Alert className="mb-4">{error}</Alert>}

        {/* A seven-column month grid cannot give a usable tap target below
            ~380px: at 320px each cell is only ~39px wide, and at 220px it
            collapses to ~15px — well under the 24px minimum, so a date becomes
            effectively untappable. Below `narrow` the SAME days are listed one
            per row instead: nothing is hidden, every day stays readable, and
            tapping still opens the same day-detail panel. At and above 380px
            the month grid is kept, because that is the view people actually
            scan a calendar in and each cell is then a comfortable ~48px. */}
        <div className="grid grid-cols-7 gap-1 mb-6 min-w-0 max-narrow:hidden">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center text-[10px] sm:text-xs text-ledger-creamDim py-2 truncate">
              {d}
            </div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const dateStr = `${month}-${String(d).padStart(2, "0")}`;
            const count = byDate[dateStr]?.length || 0;
            const isToday = dateStr === todayISO;
            return (
              <button
                key={i}
                type="button"
                disabled={loading}
                onClick={() => setSelected(dateStr)}
                aria-label={`${dateStr}, ${count} booking${count === 1 ? "" : "s"}${isToday ? ", today" : ""}`}
                aria-pressed={selected === dateStr}
                className="h-14 sm:h-20 p-1 sm:p-2 text-left ledger-panel transition-colors min-w-0 disabled:opacity-60"
                style={{
                  borderColor: isToday ? "#C9A15A" : "rgba(201,161,90,0.22)",
                  background: selected === dateStr ? "rgba(201,161,90,0.1)" : isToday ? "rgba(201,161,90,0.06)" : "#3D1A2B",
                }}
              >
                <div className="flex items-center justify-between gap-0.5">
                  <span className="text-xs sm:text-sm">{d}</span>
                  {count > 0 && (
                    <span className="w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-black/40 text-white text-[9px] sm:text-[10px] flex items-center justify-center shrink-0">{count}</span>
                  )}
                </div>
                {count > 0 && <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full mt-1 sm:mt-2" style={{ background: colorFor(count) }} />}
              </button>
            );
          })}
        </div>

        {/* Ultra-narrow (≤220px) day list — the same month, one row per day. */}
        <ol className="hidden max-narrow:grid gap-1 mb-6 min-w-0">
          {cells.filter(Boolean).map((d) => {
            const dateStr = `${month}-${String(d).padStart(2, "0")}`;
            const count = byDate[dateStr]?.length || 0;
            const isToday = dateStr === todayISO;
            return (
              <li key={dateStr} className="min-w-0">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setSelected(dateStr)}
                  aria-label={`${dateStr}, ${count} booking${count === 1 ? "" : "s"}${isToday ? ", today" : ""}`}
                  aria-pressed={selected === dateStr}
                  className="w-full ledger-panel flex items-center justify-between gap-2 px-2 py-2 min-h-[44px] text-left min-w-0 disabled:opacity-60"
                  style={{
                    borderColor: isToday ? "#C9A15A" : "rgba(201,161,90,0.22)",
                    background: selected === dateStr ? "rgba(201,161,90,0.1)" : isToday ? "rgba(201,161,90,0.06)" : "#3D1A2B",
                  }}
                >
                  <span className="text-xs min-w-0 break-words">
                    {shortDate(dateStr)}{isToday ? " · today" : ""}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {count > 0 && <span className="text-[10px] text-ledger-creamDim">{count}</span>}
                    <span className="w-2 h-2 rounded-full" style={{ background: colorFor(count) }} aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {loading && <p className="text-sm text-ledger-creamDim" role="status">Loading {month}…</p>}

        {selected && !loading && (
          <div className="ledger-panel panel-pad min-w-0">
            <h2 className="panel-title mb-3">{prettyDate(selected)}</h2>
            {(byDate[selected] || []).length === 0 ? (
              <p className="text-sm text-ledger-creamDim">No bookings this day.</p>
            ) : (
              <div className="space-y-2">
                {byDate[selected].map((b) => (
                  <div key={b._id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm ledger-rule pb-2">
                    <span className="min-w-0 break-words">{b.customerName} · {b.slot}</span>
                    <span className="text-ledger-creamDim shrink-0">{b.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}

/**
 * `new Date("2026-09-25")` is parsed as UTC midnight, which renders as the
 * previous day for any negative UTC offset. Build the Date from parts so the
 * heading always matches the cell that was clicked.
 */
function prettyDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toDateString();
}

/** Compact "Sat, 12 Sep" for the ultra-narrow day list. */
function shortDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });
}
