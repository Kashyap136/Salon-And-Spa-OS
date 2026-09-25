"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import api, { getSession } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { companyId } = getSession();
    if (!companyId) return;
    const date = todayStr();
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);

    Promise.all([
      api.get(`/bookings/stats`, { params: { companyId, date } }),
      api.get(`/bookings/list`, { params: { companyId, date } }),
      api.get(`/products/list`, { params: { companyId, lowStock: true } }),
      api.get(`/memberships/list`, { params: { companyId, status: "active" } }),
    ])
      .then(([s, b, p, m]) => {
        setStats(s.data);
        setBookings(b.data || []);
        setLowStock((p.data || []).slice(0, 3));
        setExpiring((m.data || []).filter((mem) => new Date(mem.endDate) <= in7));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="font-display text-3xl text-ledger-cream">Today&apos;s page</h1>
            <p className="text-sm text-ledger-creamDim mt-1">{new Date().toDateString()}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/bookings" className="btn-gold">New Booking</Link>
            <Link href="/calendar" className="btn-ghost">Calendar</Link>
          </div>
        </div>

        {loading ? (
          <p className="text-ledger-creamDim text-sm">Opening the ledger…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard label="Bookings Today" value={stats?.total ?? 0} />
              <StatCard label="Completed" value={stats?.completed ?? 0} accent="#7FC79A" />
              <StatCard label="No-show Rate" value={`${stats?.noShowPercent ?? 0}%`} accent="#E08076" />
              <StatCard label="Revenue Today" value={`₹${(stats?.revenue ?? 0).toLocaleString("en-IN")}`} accent="#E0BD7C" />
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 ledger-panel">
                <div className="px-5 py-4 ledger-rule flex items-center justify-between">
                  <h2 className="font-display text-xl">Today&apos;s bookings</h2>
                  <Link href="/bookings" className="text-xs text-ledger-gold">View all →</Link>
                </div>
                {bookings.length === 0 ? (
                  <p className="px-5 py-8 text-sm text-ledger-creamDim">No bookings for today yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="ledger-table w-full min-w-[560px]">
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>Service</th>
                          <th>Staff</th>
                          <th>Slot</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bookings.slice(0, 8).map((b) => (
                          <tr key={b._id}>
                            <td>{b.customerName}<div className="text-xs text-ledger-creamDim">{b.phone}</div></td>
                            <td>{b.serviceId?.name || "—"}</td>
                            <td>{b.staffId?.name || "—"}</td>
                            <td>{b.slot}</td>
                            <td><StatusBadge status={b.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-6">
                <div className="ledger-panel">
                  <div className="px-5 py-4 ledger-rule">
                    <h2 className="font-display text-lg">Staff performance</h2>
                  </div>
                  <div className="p-5 space-y-3">
                    {(stats?.staffStats || []).length === 0 && (
                      <p className="text-sm text-ledger-creamDim">No completed bookings yet.</p>
                    )}
                    {(stats?.staffStats || []).map((s) => (
                      <div key={s._id} className="flex justify-between text-sm">
                        <span>{s._id}</span>
                        <span className="text-ledger-gold">₹{s.revenue?.toLocaleString("en-IN")} · {s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ledger-panel">
                  <div className="px-5 py-4 ledger-rule">
                    <h2 className="font-display text-lg">Low stock</h2>
                  </div>
                  <div className="p-5 space-y-2">
                    {lowStock.length === 0 && <p className="text-sm text-ledger-creamDim">All stocked.</p>}
                    {lowStock.map((p) => (
                      <div key={p._id} className="flex justify-between text-sm">
                        <span>{p.name}</span>
                        <StatusBadge status="low stock" label={`${p.stock} left`} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ledger-panel">
                  <div className="px-5 py-4 ledger-rule">
                    <h2 className="font-display text-lg">Memberships expiring · 7 days</h2>
                  </div>
                  <div className="p-5 space-y-2">
                    {expiring.length === 0 && <p className="text-sm text-ledger-creamDim">None expiring soon.</p>}
                    {expiring.map((m) => (
                      <div key={m._id} className="flex justify-between text-sm">
                        <span>{m.customerName}</span>
                        <span className="text-status-pending text-xs">{new Date(m.endDate).toLocaleDateString("en-IN")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
