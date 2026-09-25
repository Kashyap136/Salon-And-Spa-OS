"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, fileUrl } from "@/lib/api";
import Navbar from "@/components/Navbar";

const CATEGORIES = ["hair", "skin", "spa", "nails", "beard", "makeup"];
const GENDERS = ["U", "M", "F"];

export default function ServicesPage() {
  const [services, setServices] = useState([]);
  const [filterCat, setFilterCat] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [form, setForm] = useState({
    name: "", category: "hair", durationMins: 30, price: "", gender: "U", isCombo: false, image: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { companyId } = typeof window !== "undefined" ? getSession() : {};

  const load = useCallback(() => {
    api.get("/services/list", { params: { companyId, category: filterCat || undefined, gender: filterGender || undefined } })
      .then((r) => setServices(r.data || []))
      .catch(() => {});
  }, [companyId, filterCat, filterGender]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("name", form.name);
      fd.append("category", form.category);
      fd.append("durationMins", form.durationMins);
      fd.append("price", form.price);
      fd.append("gender", form.gender);
      fd.append("isCombo", form.isCombo);
      fd.append("companyId", companyId);
      if (form.image) fd.append("image", form.image);
      await api.post("/services/create", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm({ name: "", category: "hair", durationMins: 30, price: "", gender: "U", isCombo: false, image: null });
      load();
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not save the service.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[340px_1fr] gap-6">
        <div className="ledger-panel p-5 h-fit min-w-0">
          <h2 className="font-display text-xl mb-4">Add a service</h2>
          {error && <p className="text-xs mb-3" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" placeholder="Hair Cut, Bridal Makeup…" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Category</FieldLabel>
                <select className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Gender</FieldLabel>
                <select className="w-full" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <Input label="Duration (mins)" type="number" value={form.durationMins} onChange={(v) => setForm({ ...form, durationMins: v })} required />
              <Input label="Price (₹)" type="number" value={form.price} onChange={(v) => setForm({ ...form, price: v })} required />
            </div>
            <label className="flex items-center gap-2 text-sm text-ledger-creamDim">
              <input type="checkbox" checked={form.isCombo} onChange={(e) => setForm({ ...form, isCombo: e.target.checked })} className="!w-auto" />
              This is a combo service
            </label>
            <div>
              <FieldLabel>Image</FieldLabel>
              <input type="file" accept="image/*" onChange={(e) => setForm({ ...form, image: e.target.files[0] })} className="w-full text-xs" />
            </div>
            <button disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Add service"}</button>
          </form>
        </div>

        <div className="ledger-panel">
          <div className="px-5 py-4 ledger-rule flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-display text-xl">Services offered</h2>
            <div className="flex gap-2">
              <select className="text-xs" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="text-xs" value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                <option value="">All genders</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          {services.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No services yet — add the first one on the left.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="ledger-table w-full min-w-[720px]">
              <thead>
                <tr><th></th><th>Name</th><th>Category</th><th>Duration</th><th>Price</th><th>Gender</th><th>Combo</th></tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s._id}>
                    <td>
                      {s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileUrl(s.imageUrl)} alt={s.name} className="w-9 h-9 rounded object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded bg-ledger-panelLight" />
                      )}
                    </td>
                    <td>{s.name}</td>
                    <td className="capitalize">{s.category}</td>
                    <td>{s.durationMins} min</td>
                    <td>₹{s.price}</td>
                    <td>{s.gender}</td>
                    <td>{s.isCombo ? "Yes" : "—"}</td>
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

function FieldLabel({ children }) {
  return <span className="block text-xs text-ledger-creamDim mb-1.5">{children}</span>;
}

function Input({ label, value, onChange, ...rest }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input className="w-full" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}
