"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, fileUrl, apiErrorMessage } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Alert from "@/components/Alert";
import { CardList, CardItem, Row } from "@/components/DataCard";
import { FieldLabel, Input } from "@/components/Field";

// Must mirror the backend Staff.specialization enum (models/Staff.js). It was
// missing "beard", so a salon that sold beard services could never file a beard
// specialist — the option silently did not exist in the only UI that creates
// staff, even though the API accepted the value.
const SPECIALIZATIONS = ["hair", "skin", "spa", "nails", "beard", "makeup"];

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [filterSpec, setFilterSpec] = useState("");
  const [form, setForm] = useState({
    name: "", phone: "", specialization: "hair", experienceYears: "", salary: "",
    commissionPercent: 10, esslId: "", photo: null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const { companyId } = typeof window !== "undefined" ? getSession() : {};

  const load = useCallback(() => {
    setLoading(true);
    api.get("/staff/list", { params: { companyId, specialization: filterSpec || undefined } })
      .then((r) => {
        setStaff(Array.isArray(r.data) ? r.data : []);
        setLoadError("");
      })
      .catch((err) => {
        setStaff([]);
        setLoadError(apiErrorMessage(err, "Could not load the team."));
      })
      .finally(() => setLoading(false));
  }, [companyId, filterSpec]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
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
      setError(apiErrorMessage(err, "Could not save staff member."));
    } finally {
      setSaving(false);
    }
  }

  // Shared by the table's photo cell and the narrow-width card list.
  function staffPhoto(s) {
    return s.photoUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl(s.photoUrl)} alt={s.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
    ) : (
      <div className="w-8 h-8 rounded-full bg-ledger-panelLight shrink-0" aria-hidden="true" />
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 grid lg:grid-cols-[340px_1fr] gap-6">
      {/* Page-level heading for assistive tech; the visible card headings are
          h2s underneath it. */}
      <h1 className="sr-only">Team</h1>
        <div className="ledger-panel panel-pad h-fit min-w-0">
          <h2 className="panel-title mb-4">Add staff</h2>
          {error && <Alert className="mb-3">{error}</Alert>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Input label="Phone" type="tel" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
            <div>
              <FieldLabel>Specialization</FieldLabel>
              <select
                className="w-full"
                aria-label="Specialization"
                value={form.specialization}
                onChange={(e) => setForm({ ...form, specialization: e.target.value })}
              >
                {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Experience (yrs)" type="number" min="0" max="80" value={form.experienceYears} onChange={(v) => setForm({ ...form, experienceYears: v })} />
              <Input label="Salary (₹)" type="number" min="0" value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} />
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Commission %" type="number" min="0" max="100" value={form.commissionPercent} onChange={(v) => setForm({ ...form, commissionPercent: v })} />
              <Input label="eSSL ID" value={form.esslId} onChange={(v) => setForm({ ...form, esslId: v })} placeholder="101" />
            </div>
            <div>
              <FieldLabel>Photo</FieldLabel>
              <input
                type="file"
                accept="image/*"
                aria-label="Staff photo"
                onChange={(e) => setForm({ ...form, photo: e.target.files[0] })}
                className="w-full text-xs"
              />
            </div>
            <button type="submit" disabled={saving} className="btn-gold w-full">
              {saving ? "Saving…" : "Add staff member"}
            </button>
          </form>
        </div>

        <div className="ledger-panel min-w-0">
          <div className="panel-head ledger-rule flex items-center justify-between gap-3 flex-wrap">
            <h2 className="panel-title">Team</h2>
            <select
              className="text-xs w-full narrow:w-auto narrow:min-w-0"
              aria-label="Filter by specialization"
              value={filterSpec}
              onChange={(e) => setFilterSpec(e.target.value)}
            >
              <option value="">All specializations</option>
              {SPECIALIZATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading the team…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button type="button" onClick={load} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : staff.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">
              {filterSpec
                ? `No ${filterSpec} staff yet.`
                : "No staff yet — add your first team member."}
            </p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[760px]">
              <thead>
                <tr><th><span className="sr-only">Photo</span></th><th>Name</th><th>Phone</th><th>Specialization</th><th>Exp.</th><th>Salary</th><th>Commission</th><th>eSSL</th></tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s._id}>
                    <td>{staffPhoto(s)}</td>
                    <td className="break-words">{s.name}</td>
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
            </div>
          )}

          {/* The 760px table needs 7x horizontal scrolling at 132px; below
              640px the same staff rows render as cards. */}
          {!loading && !loadError && staff.length > 0 && (
            <CardList>
              {staff.map((s) => (
                <CardItem key={s._id}>
                  <div className="flex items-center gap-3 mb-2 min-w-0">
                    {staffPhoto(s)}
                    <p className="font-medium min-w-0 break-words">{s.name}</p>
                  </div>
                  <dl className="space-y-1">
                    <Row label="Phone">{s.phone}</Row>
                    <Row label="Specialization"><span className="capitalize">{s.specialization}</span></Row>
                    <Row label="Experience">{s.experienceYears || 0} yrs</Row>
                    <Row label="Salary">₹{s.salary?.toLocaleString("en-IN")}</Row>
                    <Row label="Commission">{s.commissionPercent}%</Row>
                    <Row label="eSSL">{s.esslId || "—"}</Row>
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
