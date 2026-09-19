"use client";

import { useEffect, useState } from "react";
import api, { getSession } from "@/lib/api";
import Navbar from "@/components/Navbar";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [month, setMonth] = useState(currentMonth());
  const [byDate, setByDate] = useState({});
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.get("/bookings/calendar", { params: { companyId, month } })
      .then((r) => setByDate(r.data?.byDate || {}))
      .catch(() => setByDate({}));
    setSelected(null);
  }, [month]);

  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const todayISO = new Date().toISOString().slice(0, 10);

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
      <main className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl">Booking calendar</h1>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="text-sm" />
        </div>

        <div className="flex gap-4 mb-4 text-xs text-ledger-creamDim">
          <Legend color="#4F9A6A" label="< 3 bookings" />
          <Legend color="#D6A24B" label="3–5 bookings" />
          <Legend color="#C1554A" label="> 5 bookings" />
        </div>

        <div className="grid grid-cols-7 gap-1 mb-6">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center text-xs text-ledger-creamDim py-2">{d}</div>
          ))}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const dateStr = `${month}-${String(d).padStart(2, "0")}`;
            const count = byDate[dateStr]?.length || 0;
            const isToday = dateStr === todayISO;
            return (
              <button
                key={i}
                onClick={() => setSelected(dateStr)}
                className="h-20 p-2 text-left ledger-panel transition-colors"
                style={{
                  borderColor: isToday ? "#C9A15A" : "rgba(201,161,90,0.22)",
                  background: selected === dateStr ? "rgba(201,161,90,0.1)" : isToday ? "rgba(201,161,90,0.06)" : "#3D1A2B",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm">{d}</span>
                  {count > 0 && (
                    <span className="w-5 h-5 rounded-full bg-black/40 text-white text-[10px] flex items-center justify-center">{count}</span>
                  )}
                </div>
                {count > 0 && <div className="w-2 h-2 rounded-full mt-2" style={{ background: colorFor(count) }} />}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className="ledger-panel p-5">
            <h2 className="font-display text-xl mb-3">{new Date(selected).toDateString()}</h2>
            {(byDate[selected] || []).length === 0 ? (
              <p className="text-sm text-ledger-creamDim">No bookings this day.</p>
            ) : (
              <div className="space-y-2">
                {byDate[selected].map((b) => (
                  <div key={b._id} className="flex justify-between text-sm ledger-rule pb-2">
                    <span>{b.customerName} · {b.slot}</span>
                    <span className="text-ledger-creamDim">{b.status}</span>
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
