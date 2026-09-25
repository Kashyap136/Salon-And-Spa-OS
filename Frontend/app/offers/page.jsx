"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";

export default function OffersPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [offers, setOffers] = useState([]);
  const [form, setForm] = useState({
    code: "", title: "", discountType: "percent", discountValue: "", minOrderAmount: "",
    maxDiscount: "", usageLimit: "", validFrom: "", validUntil: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get("/offers/list", { params: { companyId } }).then((r) => setOffers(r.data || [])).catch(() => {});
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/offers/create", {
        companyId,
        ...form,
        discountValue: Number(form.discountValue),
        minOrderAmount: Number(form.minOrderAmount) || 0,
        maxDiscount: Number(form.maxDiscount) || 0,
        usageLimit: Number(form.usageLimit) || 0,
        applicableServices: [],
        applicablePackages: [],
      });
      setForm({ code: "", title: "", discountType: "percent", discountValue: "", minOrderAmount: "", maxDiscount: "", usageLimit: "", validFrom: "", validUntil: "" });
      load();
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not save the offer.");
    } finally {
      setSaving(false);
    }
  }

  function status(o) {
    const now = new Date();
    if (o.validUntil && new Date(o.validUntil) < now) return "expired";
    if (o.usageLimit && o.usedCount >= o.usageLimit) return "expired";
    return "valid";
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[380px_1fr] gap-6">
        <div className="ledger-panel p-5 h-fit min-w-0">
          <h2 className="font-display text-xl mb-4">New coupon</h2>
          {error && <p className="text-xs mb-3" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Code" placeholder="DIWALI20" value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} required />
            <Input label="Title" placeholder="Diwali Offer 20% OFF" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Type</FieldLabel>
                <select className="w-full" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
                  <option value="percent">Percent</option>
                  <option value="flat">Flat</option>
                </select>
              </div>
              <Input label="Value" type="number" value={form.discountValue} onChange={(v) => setForm({ ...form, discountValue: v })} required />
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <Input label="Min order (₹)" type="number" value={form.minOrderAmount} onChange={(v) => setForm({ ...form, minOrderAmount: v })} />
              <Input label="Max discount (₹)" type="number" value={form.maxDiscount} onChange={(v) => setForm({ ...form, maxDiscount: v })} />
            </div>
            <Input label="Usage limit" type="number" value={form.usageLimit} onChange={(v) => setForm({ ...form, usageLimit: v })} placeholder="100" />
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <Input label="Valid from" type="date" value={form.validFrom} onChange={(v) => setForm({ ...form, validFrom: v })} required />
              <Input label="Valid until" type="date" value={form.validUntil} onChange={(v) => setForm({ ...form, validUntil: v })} required />
            </div>
            <button disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Create coupon"}</button>
          </form>
        </div>

        <div className="ledger-panel">
          <div className="px-5 py-4 ledger-rule"><h2 className="font-display text-xl">Offers &amp; coupons</h2></div>
          {offers.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No coupons yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="ledger-table w-full min-w-[720px]">
                <thead><tr><th>Code</th><th>Title</th><th>Discount</th><th>Min order</th><th>Used</th><th>Valid</th><th>Status</th></tr></thead>
                <tbody>
                  {offers.map((o) => (
                    <tr key={o._id}>
                      <td className="font-semibold text-ledger-gold">{o.code}</td>
                      <td>{o.title}</td>
                      <td>{o.discountType === "percent" ? `${o.discountValue}%` : `₹${o.discountValue}`}</td>
                      <td>₹{o.minOrderAmount || 0}</td>
                      <td>{o.usedCount || 0}/{o.usageLimit || "∞"}</td>
                      <td className="text-xs">{new Date(o.validFrom).toLocaleDateString("en-IN")} – {new Date(o.validUntil).toLocaleDateString("en-IN")}</td>
                      <td><StatusBadge status={status(o)} /></td>
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
