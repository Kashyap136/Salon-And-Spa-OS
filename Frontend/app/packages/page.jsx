"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession } from "@/lib/api";
import Navbar from "@/components/Navbar";

export default function PackagesPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [services, setServices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [form, setForm] = useState({ name: "", price: "", originalPrice: "", validityDays: 30, selected: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get("/packages/list", { params: { companyId } }).then((r) => setPackages(r.data || [])).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    api.get("/services/list", { params: { companyId } }).then((r) => setServices(r.data || [])).catch(() => {});
    load();
  }, [load, companyId]);

  function toggleService(id) {
    setForm((f) => ({
      ...f,
      selected: f.selected.includes(id) ? f.selected.filter((x) => x !== id) : [...f.selected, id],
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/packages/create", {
        companyId,
        name: form.name,
        price: Number(form.price),
        originalPrice: Number(form.originalPrice),
        validityDays: Number(form.validityDays),
        services: form.selected.map((id) => ({ serviceId: id, qty: 1 })),
      });
      setForm({ name: "", price: "", originalPrice: "", validityDays: 30, selected: [] });
      load();
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not save the package.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[380px_1fr] gap-6">
        <div className="ledger-panel p-5 h-fit min-w-0">
          <h2 className="font-display text-xl mb-4">New package</h2>
          {error && <p className="text-xs mb-3" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" placeholder="Bridal Package" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <div>
              <FieldLabel>Included services</FieldLabel>
              <div className="max-h-40 overflow-y-auto ledger-panel !bg-ledger-base p-2 space-y-1">
                {services.map((s) => (
                  <label key={s._id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.selected.includes(s._id)} onChange={() => toggleService(s._id)} className="!w-auto" />
                    {s.name} <span className="text-xs text-ledger-creamDim">₹{s.price}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <Input label="Package price (₹)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} required />
              <Input label="Original price (₹)" type="number" value={form.originalPrice} onChange={(v) => setForm({ ...form, originalPrice: v })} required />
            </div>
            <Input label="Validity (days)" type="number" value={form.validityDays} onChange={(v) => setForm({ ...form, validityDays: v })} required />
            {form.price && form.originalPrice && (
              <p className="text-xs" style={{ color: "#7FC79A" }}>
                Savings ₹{Math.max(form.originalPrice - form.price, 0)} ({Math.round((Math.max(form.originalPrice - form.price, 0) / form.originalPrice) * 100)}% OFF)
              </p>
            )}
            <button disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Create package"}</button>
          </form>
        </div>

        <div className="ledger-panel">
          <div className="px-5 py-4 ledger-rule"><h2 className="font-display text-xl">Packages</h2></div>
          {packages.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No packages yet — Bridal, Groom, and Spa Day bundles go here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="ledger-table w-full min-w-[640px]">
                <thead><tr><th>Name</th><th>Services</th><th>Original</th><th>Price</th><th>Savings</th><th>Validity</th></tr></thead>
                <tbody>
                  {packages.map((p) => (
                    <tr key={p._id}>
                      <td>{p.name}</td>
                      <td>{p.services?.length || 0} services</td>
                      <td className="line-through text-ledger-creamDim">₹{p.originalPrice}</td>
                      <td className="font-semibold">₹{p.price}</td>
                      <td style={{ color: "#7FC79A" }}>₹{p.savings} OFF</td>
                      <td>{p.validityDays} days</td>
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
