"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import api, { getSession, apiErrorMessage } from "@/lib/api";
import { todayStr, addDaysStr } from "@/lib/date";
import Navbar from "@/components/Navbar";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import Alert from "@/components/Alert";
import { CardList, CardItem, Row } from "@/components/DataCard";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [noSession, setNoSession] = useState(false);

  const load = useCallback(async () => {
    const { companyId } = getSession();
    if (!companyId) {
      // Without a session there is nothing to load. Leaving `loading` true
      // forever rendered a permanent "Opening the ledger…" with no way out.
      setNoSession(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const date = todayStr();
    const in7 = new Date(`${addDaysStr(7)}T00:00:00`);

    // allSettled: one failing panel (e.g. a permissions/validation error on
    // products) must not blank the entire dashboard. Promise.all turned a
    // single failure into a fully empty page.
    const [s, b, p, m] = await Promise.allSettled([
      api.get("/bookings/stats", { params: { companyId, date } }),
      api.get("/bookings/list", { params: { companyId, date } }),
      api.get("/products/list", { params: { companyId, lowStock: true } }),
      api.get("/memberships/list", { params: { companyId, status: "active" } }),
    ]);

    if (s.status === "fulfilled") setStats(s.value.data);
    else setError(apiErrorMessage(s.reason, "Could not load today's stats."));

    setBookings(b.status === "fulfilled" && Array.isArray(b.value.data) ? b.value.data : []);
    setLowStock(
      p.status === "fulfilled" && Array.isArray(p.value.data) ? p.value.data.slice(0, 3) : []
    );
    setExpiring(
      m.status === "fulfilled" && Array.isArray(m.value.data)
        ? m.value.data.filter((mem) => new Date(mem.endDate) <= in7)
        : []
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (noSession) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="page max-w-[1400px] mx-auto py-16 text-center space-y-4">
          <h1 className="page-title text-ledger-cream">No active session</h1>
          <p className="text-sm text-ledger-creamDim">
            Your session has expired or you are not signed in on this device.
          </p>
          <Link href="/" className="btn-gold inline-block">Sign in</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <div className="min-w-0">
            <h1 className="page-title text-ledger-cream max-tiny:text-lg">Today&apos;s page</h1>
            <p className="text-sm text-ledger-creamDim mt-1 break-words">{new Date().toDateString()}</p>
          </div>
          <div className="action-row">
            <Link href="/bookings" className="btn-gold">New Booking</Link>
            <Link href="/calendar" className="btn-ghost">Calendar</Link>
          </div>
        </div>

        {error && <Alert className="mb-4">{error}</Alert>}

        {loading ? (
          <p className="text-ledger-creamDim text-sm" role="status">Opening the ledger…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 narrow:grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard label="Bookings Today" value={stats?.total ?? 0} />
              <StatCard label="Completed" value={stats?.completed ?? 0} accent="#7FC79A" />
              <StatCard label="No-show Rate" value={`${stats?.noShowPercent ?? 0}%`} accent="#E08076" />
              <StatCard label="Revenue Today" value={`₹${(stats?.revenue ?? 0).toLocaleString("en-IN")}`} accent="#E0BD7C" />
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 ledger-panel">
                <div className="panel-head ledger-rule flex items-center justify-between flex-wrap gap-3">
                  <h2 className="panel-title">Today&apos;s bookings</h2>
                  <Link href="/bookings" className="text-xs text-ledger-gold shrink-0 max-sm:inline-flex max-sm:items-center max-sm:min-h-[44px]">View all →</Link>
                </div>
                {bookings.length === 0 ? (
                  <p className="panel-body py-8 text-sm text-ledger-creamDim">No bookings for today yet.</p>
                ) : (
                  <div className="overflow-x-auto max-sm:hidden">
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
                            <td className="break-words">{b.customerName}<div className="text-xs text-ledger-creamDim">{b.phone}</div></td>
                            <td className="break-words">{b.serviceId?.name || "—"}</td>
                            <td className="break-words">{b.staffId?.name || "—"}</td>
                            <td>{b.slot}</td>
                            <td><StatusBadge status={b.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* The 560px table needs 5x horizontal scrolling at 132px;
                    below 640px today's bookings render as cards. */}
                {bookings.length > 0 && (
                  <CardList className="px-4 pb-4">
                    {bookings.slice(0, 8).map((b) => (
                      <CardItem key={b._id}>
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-2 min-w-0">
                          <p className="font-medium min-w-0 break-words">{b.customerName}</p>
                          <StatusBadge status={b.status} />
                        </div>
                        <dl className="space-y-1">
                          <Row label="Phone">{b.phone}</Row>
                          <Row label="Service">{b.serviceId?.name || "—"}</Row>
                          <Row label="Staff">{b.staffId?.name || "—"}</Row>
                          <Row label="Slot">{b.slot}</Row>
                        </dl>
                      </CardItem>
                    ))}
                  </CardList>
                )}
              </div>

              <div className="flex flex-col gap-6">
                <div className="ledger-panel">
                  <div className="panel-head ledger-rule">
                    <h2 className="panel-title text-lg max-tiny:text-sm">Staff performance</h2>
                  </div>
                  <div className="panel-pad space-y-3">
                    {(stats?.staffStats || []).length === 0 && (
                      <p className="text-sm text-ledger-creamDim">No completed bookings yet.</p>
                    )}
                    {(stats?.staffStats || []).map((s) => (
                      <div key={s._id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                        <span className="min-w-0 break-words">{s._id}</span>
                        <span className="text-ledger-gold">₹{s.revenue?.toLocaleString("en-IN")} · {s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ledger-panel">
                  <div className="panel-head ledger-rule">
                    <h2 className="panel-title text-lg max-tiny:text-sm">Low stock</h2>
                  </div>
                  <div className="panel-pad space-y-2">
                    {lowStock.length === 0 && <p className="text-sm text-ledger-creamDim">All stocked.</p>}
                    {lowStock.map((p) => (
                      <div key={p._id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                        <span className="min-w-0 break-words">{p.name}</span>
                        <StatusBadge status="low stock" label={`${p.stock} left`} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ledger-panel">
                  <div className="panel-head ledger-rule">
                    <h2 className="panel-title text-lg max-tiny:text-sm">Expiring memberships</h2>
                  </div>
                  <div className="panel-pad space-y-2">
                    {expiring.length === 0 && <p className="text-sm text-ledger-creamDim">None expiring soon.</p>}
                    {expiring.map((m) => (
                      <div key={m._id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                        <span className="min-w-0 break-words">{m.customerName}</span>
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
