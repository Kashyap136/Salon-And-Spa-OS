"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, apiErrorMessage } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import Alert from "@/components/Alert";
import { FieldLabel, Input } from "@/components/Field";
import { CardList, CardItem, Row } from "@/components/DataCard";

export default function OffersPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [offers, setOffers] = useState([]);
  const [form, setForm] = useState({
    code: "", title: "", discountType: "percent", discountValue: "", minOrderAmount: "",
    maxDiscount: "", usageLimit: "", validFrom: "", validUntil: "",
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get("/offers/list", { params: { companyId } })
      .then((r) => { setOffers(Array.isArray(r.data) ? r.data : []); setLoadError(""); })
      .catch((err) => { setOffers([]); setLoadError(apiErrorMessage(err, "Could not load offers.")); })
      .finally(() => setLoading(false));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
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
      setError(apiErrorMessage(err, "Could not save the offer."));
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

  // Shared by the table's Valid cell and the narrow-width card list.
  function validWindow(o) {
    return `${new Date(o.validFrom).toLocaleDateString("en-IN")} – ${new Date(o.validUntil).toLocaleDateString("en-IN")}`;
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 grid lg:grid-cols-[380px_1fr] gap-6">
      {/* Page-level heading for assistive tech; the visible card headings are
          h2s underneath it. */}
      <h1 className="sr-only">Offers and coupons</h1>
        <div className="ledger-panel panel-pad h-fit min-w-0">
          <h2 className="panel-title mb-4">New coupon</h2>
          {error && <Alert className="mb-3">{error}</Alert>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Code" placeholder="DIWALI20" value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} required />
            <Input label="Title" placeholder="Diwali Offer 20% OFF" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Type</FieldLabel>
                <select className="w-full" aria-label="Discount type" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
                  <option value="percent">Percent</option>
                  <option value="flat">Flat</option>
                </select>
              </div>
              <Input label="Value" type="number" min="1" value={form.discountValue} onChange={(v) => setForm({ ...form, discountValue: v })} required />
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Min order (₹)" type="number" value={form.minOrderAmount} onChange={(v) => setForm({ ...form, minOrderAmount: v })} />
              <Input label="Max discount (₹)" type="number" value={form.maxDiscount} onChange={(v) => setForm({ ...form, maxDiscount: v })} />
            </div>
            <Input label="Usage limit" type="number" min="0" value={form.usageLimit} onChange={(v) => setForm({ ...form, usageLimit: v })} placeholder="0 = unlimited" />
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Valid from" type="date" value={form.validFrom} onChange={(v) => setForm({ ...form, validFrom: v })} required />
              <Input label="Valid until" type="date" min={form.validFrom || undefined} value={form.validUntil} onChange={(v) => setForm({ ...form, validUntil: v })} required />
            </div>
            <button type="submit" disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Create coupon"}</button>
          </form>
        </div>

        <div className="ledger-panel min-w-0">
          <div className="panel-head ledger-rule"><h2 className="panel-title">Offers &amp; coupons</h2></div>
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading offers…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button type="button" onClick={load} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : offers.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">No coupons yet.</p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[720px]">
                <thead><tr><th>Code</th><th>Title</th><th>Discount</th><th>Min order</th><th>Used</th><th>Valid</th><th>Status</th></tr></thead>
                <tbody>
                  {offers.map((o) => (
                    <tr key={o._id}>
                      <td className="font-semibold text-ledger-gold break-words">{o.code}</td>
                      <td className="break-words">{o.title}</td>
                      <td>{o.discountType === "percent" ? `${o.discountValue}%` : `₹${o.discountValue}`}</td>
                      <td>₹{o.minOrderAmount || 0}</td>
                      <td>{o.usedCount || 0}/{o.usageLimit || "∞"}</td>
                      <td className="text-xs">{validWindow(o)}</td>
                      <td><StatusBadge status={status(o)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The 720px table needs 6x horizontal scrolling at 132px; below
              640px the same coupons render as cards. */}
          {!loading && !loadError && offers.length > 0 && (
            <CardList>
              {offers.map((o) => (
                <CardItem key={o._id}>
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2 min-w-0">
                    <p className="font-semibold text-ledger-gold min-w-0 break-words">{o.code}</p>
                    <StatusBadge status={status(o)} />
                  </div>
                  <dl className="space-y-1">
                    <Row label="Title">{o.title}</Row>
                    <Row label="Discount">
                      {o.discountType === "percent" ? `${o.discountValue}%` : `₹${o.discountValue}`}
                    </Row>
                    <Row label="Min order">₹{o.minOrderAmount || 0}</Row>
                    <Row label="Used">{o.usedCount || 0}/{o.usageLimit || "∞"}</Row>
                    <Row label="Valid">{validWindow(o)}</Row>
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
