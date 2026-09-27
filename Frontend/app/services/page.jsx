"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, fileUrl, apiErrorMessage } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Alert from "@/components/Alert";
import { CardList, CardItem, Row } from "@/components/DataCard";
import { FieldLabel, Input } from "@/components/Field";

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  const { companyId } = typeof window !== "undefined" ? getSession() : {};

  const load = useCallback(() => {
    setLoading(true);
    api.get("/services/list", { params: { companyId, category: filterCat || undefined, gender: filterGender || undefined } })
      .then((r) => { setServices(Array.isArray(r.data) ? r.data : []); setLoadError(""); })
      .catch((err) => { setServices([]); setLoadError(apiErrorMessage(err, "Could not load services.")); })
      .finally(() => setLoading(false));
  }, [companyId, filterCat, filterGender]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
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
      setError(apiErrorMessage(err, "Could not save the service."));
    } finally {
      setSaving(false);
    }
  }

  // Shared by the table's thumbnail cell and the narrow-width card list.
  function serviceThumb(s) {
    return s.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl(s.imageUrl)} alt={s.name} className="w-9 h-9 rounded object-cover shrink-0" />
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
      <h1 className="sr-only">Services offered</h1>
        <div className="ledger-panel panel-pad h-fit min-w-0">
          <h2 className="panel-title mb-4">Add a service</h2>
          {error && <Alert className="mb-3">{error}</Alert>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" placeholder="Hair Cut, Bridal Makeup…" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Category</FieldLabel>
                <select className="w-full" aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Gender</FieldLabel>
                <select className="w-full" aria-label="Gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  {GENDERS.map((g) => <option key={g} value={g}>{g === "U" ? "Unisex" : g === "M" ? "Male" : "Female"}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Duration (mins)" type="number" min="15" max="480" value={form.durationMins} onChange={(v) => setForm({ ...form, durationMins: v })} required />
              <Input label="Price (₹)" type="number" min="0" value={form.price} onChange={(v) => setForm({ ...form, price: v })} required />
            </div>
            <label className="check-row text-sm text-ledger-creamDim">
              <input type="checkbox" checked={form.isCombo} onChange={(e) => setForm({ ...form, isCombo: e.target.checked })} />
              <span>Combo service</span>
            </label>
            <div>
              <FieldLabel>Image</FieldLabel>
              <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Service image" onChange={(e) => setForm({ ...form, image: e.target.files[0] })} className="w-full text-xs" />
            </div>
            <button type="submit" disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Add service"}</button>
          </form>
        </div>

        <div className="ledger-panel min-w-0">
          <div className="panel-head ledger-rule flex items-center justify-between flex-wrap gap-3">
            <h2 className="panel-title">Services offered</h2>
            <div className="filter-row">
              <select className="text-xs" aria-label="Filter by category" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="text-xs" aria-label="Filter by gender" value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                <option value="">All genders</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading services…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button type="button" onClick={load} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : services.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">No services yet — add the first one on the left.</p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[720px]">
              <thead>
                <tr><th></th><th>Name</th><th>Category</th><th>Duration</th><th>Price</th><th>Gender</th><th>Combo</th></tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s._id}>
                    <td>{serviceThumb(s)}</td>
                    <td className="break-words">{s.name}</td>
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

          {/* The 720px table needs 6x horizontal scrolling at 132px; below
              640px the same services render as cards. */}
          {!loading && !loadError && services.length > 0 && (
            <CardList>
              {services.map((s) => (
                <CardItem key={s._id}>
                  <div className="flex items-center gap-3 mb-2 min-w-0">
                    {serviceThumb(s)}
                    <p className="font-medium min-w-0 break-words">{s.name}</p>
                  </div>
                  <dl className="space-y-1">
                    <Row label="Category"><span className="capitalize">{s.category}</span></Row>
                    <Row label="Duration">{s.durationMins} min</Row>
                    <Row label="Price">₹{s.price}</Row>
                    <Row label="Gender">{s.gender}</Row>
                    <Row label="Combo">{s.isCombo ? "Yes" : "—"}</Row>
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
