"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, fileUrl, apiErrorMessage } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import Alert from "@/components/Alert";
import { FieldLabel, Input } from "@/components/Field";
import { CardList, CardItem, Row } from "@/components/DataCard";

export default function ProductsPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [products, setProducts] = useState([]);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [form, setForm] = useState({ name: "", brand: "", price: "", gstPercent: 18, stock: "", minStock: 5, images: [] });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get("/products/list", { params: { companyId, lowStock: lowStockOnly || undefined } })
      .then((r) => { setProducts(Array.isArray(r.data) ? r.data : []); setLoadError(""); })
      .catch((err) => { setProducts([]); setLoadError(apiErrorMessage(err, "Could not load products.")); })
      .finally(() => setLoading(false));
  }, [companyId, lowStockOnly]);
  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries({ ...form, companyId }).forEach(([k, v]) => {
        if (k !== "images" && v !== null && v !== undefined) fd.append(k, v);
      });
      form.images.forEach((img) => fd.append("images", img));
      await api.post("/products/create", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm({ name: "", brand: "", price: "", gstPercent: 18, stock: "", minStock: 5, images: [] });
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the product."));
    } finally {
      setSaving(false);
    }
  }

  // Shared by the table's thumbnail cell and the narrow-width card list.
  function productThumb(p) {
    return p.images?.[0] ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl(p.images[0])} alt={p.name} className="w-9 h-9 rounded object-cover shrink-0" />
    ) : (
      <div className="w-9 h-9 rounded bg-ledger-panelLight shrink-0" />
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 grid lg:grid-cols-[340px_1fr] gap-6">
      {/* Page-level heading for assistive tech; the visible card headings are
          h2s underneath it. */}
      <h1 className="sr-only">Retail products</h1>
        <div className="ledger-panel panel-pad h-fit min-w-0">
          <h2 className="panel-title mb-4">Add product</h2>
          {error && <p className="text-xs mb-3 break-words" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" placeholder="Shampoo, Hair Oil…" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Input label="Brand" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} />
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Price (₹)" type="number" min="0" step="0.01" value={form.price} onChange={(v) => setForm({ ...form, price: v })} required />
              <Input label="GST %" type="number" min="0" max="100" value={form.gstPercent} onChange={(v) => setForm({ ...form, gstPercent: v })} />
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Stock" type="number" min="0" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} required />
              <Input label="Min stock alert" type="number" min="0" value={form.minStock} onChange={(v) => setForm({ ...form, minStock: v })} />
            </div>
            <div>
              <FieldLabel>Images</FieldLabel>
              <input type="file" accept="image/*" multiple aria-label="Product images" onChange={(e) => setForm({ ...form, images: Array.from(e.target.files) })} className="w-full text-xs" />
            </div>
            <button disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Add product"}</button>
          </form>
        </div>

        <div className="ledger-panel min-w-0">
          <div className="panel-head ledger-rule flex items-center justify-between flex-wrap gap-3">
            <h2 className="panel-title">Retail products</h2>
            <label className="check-row text-xs text-ledger-creamDim">
              <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
              <span>Low stock only</span>
            </label>
          </div>
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading products…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button type="button" onClick={load} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : products.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">No products yet.</p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[680px]">
                <thead><tr><th></th><th>Name</th><th>Brand</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p._id}>
                      <td>{productThumb(p)}</td>
                      <td className="break-words">{p.name}</td>
                      <td>{p.brand || "—"}</td>
                      <td>₹{p.price}</td>
                      <td>{p.stock} <span className="text-xs text-ledger-creamDim">/ min {p.minStock}</span></td>
                      <td><StatusBadge status={p.stock <= p.minStock ? "low stock" : "in stock"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The 680px table needs 6x horizontal scrolling at 132px; below
              640px the same products render as cards. */}
          {!loading && !loadError && products.length > 0 && (
            <CardList>
              {products.map((p) => (
                <CardItem key={p._id}>
                  <div className="flex items-center gap-3 mb-2 min-w-0">
                    {productThumb(p)}
                    <p className="font-medium min-w-0 break-words">{p.name}</p>
                  </div>
                  <dl className="space-y-1">
                    <Row label="Brand">{p.brand || "—"}</Row>
                    <Row label="Price">₹{p.price}</Row>
                    <Row label="Stock">
                      {p.stock} <span className="text-xs text-ledger-creamDim">/ min {p.minStock}</span>
                    </Row>
                    <Row label="Status">
                      <StatusBadge status={p.stock <= p.minStock ? "low stock" : "in stock"} />
                    </Row>
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
