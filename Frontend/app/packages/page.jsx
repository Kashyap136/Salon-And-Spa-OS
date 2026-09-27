"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, apiErrorMessage } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Alert from "@/components/Alert";
import { FieldLabel, Input } from "@/components/Field";
import { CardList, CardItem, Row } from "@/components/DataCard";

export default function PackagesPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [services, setServices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [form, setForm] = useState({ name: "", price: "", originalPrice: "", validityDays: 30, selected: [] });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get("/packages/list", { params: { companyId } })
      .then((r) => { setPackages(Array.isArray(r.data) ? r.data : []); setLoadError(""); })
      .catch((err) => { setPackages([]); setLoadError(apiErrorMessage(err, "Could not load packages.")); })
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => {
    api.get("/services/list", { params: { companyId } })
      .then((r) => setServices(Array.isArray(r.data) ? r.data : []))
      .catch((err) => setError(apiErrorMessage(err, "Could not load services.")));
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
    if (saving) return;
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
      setError(apiErrorMessage(err, "Could not save the package."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 grid lg:grid-cols-[380px_1fr] gap-6">
      {/* Page-level heading for assistive tech; the visible card headings are
          h2s underneath it. */}
      <h1 className="sr-only">Packages</h1>
        <div className="ledger-panel panel-pad h-fit min-w-0">
          <h2 className="panel-title mb-4">New package</h2>
          {error && <Alert className="mb-3">{error}</Alert>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" placeholder="Bridal Package" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <div>
              <FieldLabel>Included services</FieldLabel>
              <div className="max-h-40 overflow-y-auto ledger-panel !bg-ledger-base p-2 space-y-1">
                {services.length === 0 && (
                  <p className="text-xs text-ledger-creamDim p-1 break-words">No services yet — add one under Services first.</p>
                )}
                {services.map((s) => (
                  <label key={s._id} className="check-row text-sm">
                    <input
                      type="checkbox"
                      checked={form.selected.includes(s._id)}
                      onChange={() => toggleService(s._id)}
                    />
                    <span>{s.name} <span className="text-xs text-ledger-creamDim">₹{s.price}</span></span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Package price (₹)" type="number" min="0" value={form.price} onChange={(v) => setForm({ ...form, price: v })} required />
              <Input label="Original price (₹)" type="number" min="0" value={form.originalPrice} onChange={(v) => setForm({ ...form, originalPrice: v })} required />
            </div>
            <Input label="Validity (days)" type="number" min="1" value={form.validityDays} onChange={(v) => setForm({ ...form, validityDays: v })} required />
            {form.price && form.originalPrice && (
              <p className="text-xs break-words" style={{ color: "#7FC79A" }}>
                Savings ₹{Math.max(form.originalPrice - form.price, 0)} ({Math.round((Math.max(form.originalPrice - form.price, 0) / form.originalPrice) * 100)}% OFF)
              </p>
            )}
            <button type="submit" disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Create package"}</button>
          </form>
        </div>

        <div className="ledger-panel min-w-0">
          <div className="panel-head ledger-rule"><h2 className="panel-title">Packages</h2></div>
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading packages…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button type="button" onClick={load} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : packages.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">No packages yet — Bridal, Groom, and Spa Day bundles go here.</p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[640px]">
                <thead><tr><th>Name</th><th>Services</th><th>Original</th><th>Price</th><th>Savings</th><th>Validity</th></tr></thead>
                <tbody>
                  {packages.map((p) => (
                    <tr key={p._id}>
                      <td className="break-words">{p.name}</td>
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

          {/* The 640px table needs 6x horizontal scrolling at 132px; below
              640px the same packages render as cards. */}
          {!loading && !loadError && packages.length > 0 && (
            <CardList>
              {packages.map((p) => (
                <CardItem key={p._id}>
                  <p className="font-medium mb-2 min-w-0 break-words">{p.name}</p>
                  <dl className="space-y-1">
                    <Row label="Services">{p.services?.length || 0} services</Row>
                    <Row label="Original">
                      <span className="line-through text-ledger-creamDim">₹{p.originalPrice}</span>
                    </Row>
                    <Row label="Price">₹{p.price}</Row>
                    <Row label="Savings">
                      <span style={{ color: "#7FC79A" }}>₹{p.savings} OFF</span>
                    </Row>
                    <Row label="Validity">{p.validityDays} days</Row>
                  </dl>
                </CardItem>
              ))}
            </CardList>
          )}
        </div>
      </main>
    </div>
  );
}
