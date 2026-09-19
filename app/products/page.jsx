"use client";

import { useEffect, useState } from "react";
import api, { getSession, fileUrl } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";

export default function ProductsPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [products, setProducts] = useState([]);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [form, setForm] = useState({ name: "", brand: "", price: "", gstPercent: 18, stock: "", minStock: 5, images: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    api.get("/products/list", { params: { companyId, lowStock: lowStockOnly || undefined } })
      .then((r) => setProducts(r.data || [])).catch(() => {});
  }
  useEffect(() => { load(); }, [lowStockOnly]);

  async function submit(e) {
    e.preventDefault();
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
      setError(err?.response?.data?.msg || "Could not save the product.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-6 py-8 grid lg:grid-cols-[340px_1fr] gap-6">
        <div className="ledger-panel p-5 h-fit">
          <h2 className="font-display text-xl mb-4">Add product</h2>
          {error && <p className="text-xs mb-3" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" placeholder="Shampoo, Hair Oil…" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Input label="Brand" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Price (₹)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} required />
              <Input label="GST %" type="number" value={form.gstPercent} onChange={(v) => setForm({ ...form, gstPercent: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Stock" type="number" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} required />
              <Input label="Min stock alert" type="number" value={form.minStock} onChange={(v) => setForm({ ...form, minStock: v })} />
            </div>
            <div>
              <FieldLabel>Images</FieldLabel>
              <input type="file" accept="image/*" multiple onChange={(e) => setForm({ ...form, images: Array.from(e.target.files) })} className="w-full text-xs" />
            </div>
            <button disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Add product"}</button>
          </form>
        </div>

        <div className="ledger-panel">
          <div className="px-5 py-4 ledger-rule flex items-center justify-between">
            <h2 className="font-display text-xl">Retail products</h2>
            <label className="flex items-center gap-2 text-xs text-ledger-creamDim">
              <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} className="!w-auto" />
              Low stock only
            </label>
          </div>
          {products.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No products yet.</p>
          ) : (
            <table className="ledger-table w-full">
              <thead><tr><th></th><th>Name</th><th>Brand</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p._id}>
                    <td>
                      {p.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileUrl(p.images[0])} alt={p.name} className="w-9 h-9 rounded object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded bg-ledger-panelLight" />
                      )}
                    </td>
                    <td>{p.name}</td>
                    <td>{p.brand || "—"}</td>
                    <td>₹{p.price}</td>
                    <td>{p.stock} <span className="text-xs text-ledger-creamDim">/ min {p.minStock}</span></td>
                    <td><StatusBadge status={p.stock <= p.minStock ? "low stock" : "in stock"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
