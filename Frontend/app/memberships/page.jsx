"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";

function todayStr() { return new Date().toISOString().slice(0, 10); }

export default function MembershipsPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [packages, setPackages] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [redeemSel, setRedeemSel] = useState({});
  const [form, setForm] = useState({ customerName: "", phone: "", packageId: "", startDate: todayStr() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get("/memberships/list", { params: { companyId } }).then((r) => setMemberships(r.data || [])).catch(() => {});
  }, [companyId]);
  useEffect(() => {
    api.get("/packages/list", { params: { companyId } }).then((r) => setPackages(r.data || [])).catch(() => {});
    load();
  }, [load, companyId]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/memberships/create", { companyId, ...form });
      setForm({ customerName: "", phone: "", packageId: "", startDate: todayStr() });
      load();
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not create the membership.");
    } finally {
      setSaving(false);
    }
  }

  async function redeemService(membershipId) {
    const serviceId = redeemSel[membershipId];
    if (!serviceId) return;
    try {
      await api.post("/memberships/use", { membershipId, serviceId });
      setRedeemSel({ ...redeemSel, [membershipId]: "" });
      load();
    } catch (err) {
      alert(err?.response?.data?.msg || "Could not redeem this service.");
    }
  }

  function expiringSoon(m) {
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    return m.status === "active" && new Date(m.endDate) <= in7;
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[360px_1fr] gap-6">
        <div className="ledger-panel p-5 h-fit min-w-0">
          <h2 className="font-display text-xl mb-4">New membership</h2>
          {error && <p className="text-xs mb-3" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Customer name" value={form.customerName} onChange={(v) => setForm({ ...form, customerName: v })} required />
            <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
            <div>
              <FieldLabel>Package</FieldLabel>
              <select className="w-full" value={form.packageId} onChange={(e) => setForm({ ...form, packageId: e.target.value })} required>
                <option value="">Select a package</option>
                {packages.map((p) => <option key={p._id} value={p._id}>{p.name} — ₹{p.price} · {p.validityDays}d</option>)}
              </select>
            </div>
            <Input label="Start date" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} required />
            <button disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Create membership"}</button>
          </form>
        </div>

        <div className="ledger-panel">
          <div className="px-5 py-4 ledger-rule"><h2 className="font-display text-xl">Memberships</h2></div>
          {memberships.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No memberships yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="ledger-table w-full min-w-[820px]">
                <thead><tr><th>Customer</th><th>Package</th><th>Start</th><th>End</th><th>Used/Total</th><th>Status</th><th>Redeem</th></tr></thead>
                <tbody>
                  {memberships.map((m) => (
                    <tr key={m._id}>
                      <td>{m.customerName}<div className="text-xs text-ledger-creamDim">{m.phone}</div></td>
                      <td>{m.packageId?.name || "—"}</td>
                      <td>{new Date(m.startDate).toLocaleDateString("en-IN")}</td>
                      <td>
                        {new Date(m.endDate).toLocaleDateString("en-IN")}
                        {expiringSoon(m) && <span className="pill ml-2" style={{ background: "rgba(214,162,75,0.18)", color: "#E0BD7C" }}>Expiring soon</span>}
                      </td>
                      <td>{m.servicesUsed?.length || 0}/{m.servicesTotal}</td>
                      <td><StatusBadge status={m.status} /></td>
                      <td>
                        {m.status === "active" && (
                          <div className="flex flex-wrap items-center gap-1">
                            <select
                              value={redeemSel[m._id] || ""}
                              onChange={(e) => setRedeemSel({ ...redeemSel, [m._id]: e.target.value })}
                              className="text-xs !px-1.5 !py-1 max-w-[150px]"
                              aria-label={`Redeem service for ${m.customerName}`}
                            >
                              <option value="">Select service</option>
                              {(m.packageId?.services || []).map((line) => {
                                const svc = line.serviceId;
                                if (!svc || !svc._id) return null;
                                const used = (m.servicesUsed || []).filter((u) => String(u.serviceId) === String(svc._id)).length;
                                const left = Math.max((line.qty || 1) - used, 0);
                                return (
                                  <option key={svc._id} value={svc._id} disabled={left === 0}>
                                    {svc.name} ({left} left)
                                  </option>
                                );
                              })}
                            </select>
                            <button
                              disabled={!redeemSel[m._id] || !m.packageId?.services?.length}
                              onClick={() => redeemService(m._id)}
                              className="btn-ghost text-xs !py-1"
                            >
                              Redeem
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function FieldLabel({ children }) { return <span className="block text-xs text-ledger-creamDim mb-1.5">{children}</span>; }
function Input({ label, value, onChange, ...rest }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input className="w-full" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}
