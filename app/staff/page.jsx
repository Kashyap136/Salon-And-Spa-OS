"use client";

import { useEffect, useState } from "react";
import api, { getSession, fileUrl } from "@/lib/api";
import Navbar from "@/components/Navbar";

const SPECIALIZATIONS = ["hair", "skin", "spa", "nails", "makeup"];

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [filterSpec, setFilterSpec] = useState("");
  const [form, setForm] = useState({
    name: "", phone: "", specialization: "hair", experienceYears: "", salary: "",
    commissionPercent: 10, esslId: "", photo: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { companyId } = typeof window !== "undefined" ? getSession() : {};

  function load() {
    api.get("/staff/list", { params: { companyId, specialization: filterSpec || undefined } })
      .then((r) => setStaff(r.data || []))
      .catch(() => {});
  }

  useEffect(() => { load(); }, [filterSpec]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries({ ...form, companyId }).forEach(([k, v]) => {
        if (k !== "photo" && v !== null && v !== undefined) fd.append(k, v);
      });
      if (form.photo) fd.append("photo", form.photo);
      await api.post("/staff/create", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setForm({ name: "", phone: "", specialization: "hair", experienceYears: "", salary: "", commissionPercent: 10, esslId: "", photo: null });
      load();
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not save staff member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-6 py-8 grid lg:grid-cols-[340px_1fr] gap-6">
        <div className="ledger-panel p-5 h-fit">
          <h2 className="font-display text-xl mb-4">Add staff</h2>
          {error && <p className="text-xs mb-3" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
            <div>
              <FieldLabel>Specialization</FieldLabel>
              <select className="w-full" value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })}>
                {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Experience (yrs)" type="number" value={form.experienceYears} onChange={(v) => setForm({ ...form, experienceYears: v })} />
              <Input label="Salary (₹)" type="number" value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Commission %" type="number" value={form.commissionPercent} onChange={(v) => setForm({ ...form, commissionPercent: v })} />
              <Input label="eSSL ID" value={form.esslId} onChange={(v) => setForm({ ...form, esslId: v })} placeholder="101" />
            </div>
            <div>
              <FieldLabel>Photo</FieldLabel>
              <input type="file" accept="image/*" onChange={(e) => setForm({ ...form, photo: e.target.files[0] })} className="w-full text-xs" />
            </div>
            <button disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Add staff member"}</button>
          </form>
        </div>

        <div className="ledger-panel">
          <div className="px-5 py-4 ledger-rule flex items-center justify-between">
            <h2 className="font-display text-xl">Team</h2>
            <select className="text-xs" value={filterSpec} onChange={(e) => setFilterSpec(e.target.value)}>
              <option value="">All specializations</option>
              {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {staff.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No staff yet — add your first team member.</p>
          ) : (
            <table className="ledger-table w-full">
              <thead>
                <tr><th></th><th>Name</th><th>Phone</th><th>Specialization</th><th>Exp.</th><th>Salary</th><th>Commission</th><th>eSSL</th></tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s._id}>
                    <td>
                      {s.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileUrl(s.photoUrl)} alt={s.name} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-ledger-panelLight" />
                      )}
                    </td>
                    <td>{s.name}</td>
                    <td>{s.phone}</td>
                    <td className="capitalize">{s.specialization}</td>
                    <td>{s.experienceYears || 0} yrs</td>
                    <td>₹{s.salary?.toLocaleString("en-IN")}</td>
                    <td>{s.commissionPercent}%</td>
                    <td>{s.esslId || "—"}</td>
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
