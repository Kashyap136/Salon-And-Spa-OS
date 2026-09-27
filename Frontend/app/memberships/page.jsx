"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, apiErrorMessage } from "@/lib/api";
import { todayStr } from "@/lib/date";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import Alert from "@/components/Alert";
import { FieldLabel, Input } from "@/components/Field";
import { CardList, CardItem, Row } from "@/components/DataCard";

export default function MembershipsPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [packages, setPackages] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [redeemSel, setRedeemSel] = useState({});
  const [form, setForm] = useState({ customerName: "", phone: "", packageId: "", startDate: todayStr() });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/memberships/list", { params: { companyId } })
      .then((r) => { setMemberships(Array.isArray(r.data) ? r.data : []); setLoadError(""); })
      .catch((err) => { setMemberships([]); setLoadError(apiErrorMessage(err, "Could not load memberships.")); })
      .finally(() => setLoading(false));
  }, [companyId]);
  useEffect(() => {
    api.get("/packages/list", { params: { companyId } })
      .then((r) => setPackages(Array.isArray(r.data) ? r.data : []))
      .catch((err) => setError(apiErrorMessage(err, "Could not load packages.")));
    load();
  }, [load, companyId]);

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      await api.post("/memberships/create", { companyId, ...form });
      setForm({ customerName: "", phone: "", packageId: "", startDate: todayStr() });
      setNotice(`Membership created for ${form.customerName}.`);
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not create the membership."));
    } finally {
      setSaving(false);
    }
  }

  async function redeemService(membershipId) {
    const serviceId = redeemSel[membershipId];
    if (!serviceId || busyId) return;
    setError("");
    setNotice("");
    setBusyId(membershipId);
    try {
      await api.post("/memberships/use", { membershipId, serviceId });
      setRedeemSel((s) => ({ ...s, [membershipId]: "" }));
      setNotice("Service redeemed.");
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not redeem this service."));
    } finally {
      setBusyId(null);
    }
  }

  function expiringSoon(m) {
    const in7 = new Date();
    in7.setDate(in7.getDate() + 7);
    return m.status === "active" && new Date(m.endDate) <= in7;
  }

  // Shared by the table's End and Redeem cells and the narrow-width card list.
  function membershipEnd(m) {
    return (
      <>
        {new Date(m.endDate).toLocaleDateString("en-IN")}
        {expiringSoon(m) && (
          <span className="pill ml-2" style={{ background: "rgba(214,162,75,0.18)", color: "#E0BD7C" }}>
            Expiring soon
          </span>
        )}
      </>
    );
  }

  // `stacked` is the narrow-width card form. A <select> sizes itself to its
  // widest option, so as a flex item with min-width:auto it refused to shrink
  // below that intrinsic width and pushed 11px past an 88px column. Giving it
  // w-full + min-w-0 makes the card the constraint instead of the option list.
  function membershipRedeem(m, stacked) {
    if (m.status !== "active") return null;
    return (
      <div className={stacked ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-1"}>
        <select
          value={redeemSel[m._id] || ""}
          onChange={(e) => setRedeemSel({ ...redeemSel, [m._id]: e.target.value })}
          className={
            stacked
              ? "w-full min-w-0 text-xs !px-1.5 !py-1"
              : "text-xs !px-1.5 !py-1 max-w-[150px]"
          }
          aria-label={`Redeem service for ${m.customerName}`}
        >
          <option value="">Select service</option>
          {(m.packageId?.services || []).map((line) => {
            const svc = line.serviceId;
            if (!svc || !svc._id) return null;
            const used = (m.servicesUsed || []).filter((u) => String(u.serviceId) === String(svc._id)).length;
            const left = Math.max((line.qty || 1) - used, 0);
            return (
              <option key={svc._id} value={svc._id} disabled={left === 0}>
                {svc.name} ({left} left)
              </option>
            );
          })}
        </select>
        <button
          type="button"
          disabled={!redeemSel[m._id] || !m.packageId?.services?.length || Boolean(busyId)}
          onClick={() => redeemService(m._id)}
          className={stacked ? "btn-ghost w-full text-xs !py-1" : "btn-ghost text-xs !py-1 min-w-[44px]"}
        >
          {busyId === m._id ? "…" : "Redeem"}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 grid lg:grid-cols-[360px_1fr] gap-6">
      {/* Page-level heading for assistive tech; the visible card headings are
          h2s underneath it. */}
      <h1 className="sr-only">Memberships</h1>
        <div className="ledger-panel panel-pad h-fit min-w-0">
          <h2 className="panel-title mb-4">New membership</h2>
          {error && <Alert className="mb-3">{error}</Alert>}
          {notice && <Alert tone="success" className="mb-3">{notice}</Alert>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Customer name" value={form.customerName} onChange={(v) => setForm({ ...form, customerName: v })} required />
            <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
            <div>
              <FieldLabel>Package</FieldLabel>
              <select className="w-full" aria-label="Package" value={form.packageId} onChange={(e) => setForm({ ...form, packageId: e.target.value })} required>
                <option value="">Select a package</option>
                {packages.map((p) => <option key={p._id} value={p._id}>{p.name} — ₹{p.price} · {p.validityDays}d</option>)}
              </select>
              {packages.length === 0 && (
                <p className="text-xs text-ledger-creamDim mt-1 break-words">No packages yet — create one under Packages first.</p>
              )}
            </div>
            <Input label="Start date" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} required />
            <button type="submit" disabled={saving} className="btn-gold w-full">{saving ? "Saving…" : "Create membership"}</button>
          </form>
        </div>

        <div className="ledger-panel min-w-0">
          <div className="panel-head ledger-rule"><h2 className="panel-title">Memberships</h2></div>
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading memberships…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button type="button" onClick={load} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : memberships.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">No memberships yet.</p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[820px]">
                <thead><tr><th>Customer</th><th>Package</th><th>Start</th><th>End</th><th>Used/Total</th><th>Status</th><th>Redeem</th></tr></thead>
                <tbody>
                  {memberships.map((m) => (
                    <tr key={m._id}>
                      <td className="break-words">{m.customerName}<div className="text-xs text-ledger-creamDim">{m.phone}</div></td>
                      <td className="break-words">{m.packageId?.name || "—"}</td>
                      <td>{new Date(m.startDate).toLocaleDateString("en-IN")}</td>
                      <td>{membershipEnd(m)}</td>
                      <td>{m.servicesUsed?.length || 0}/{m.servicesTotal}</td>
                      <td><StatusBadge status={m.status} /></td>
                      <td>{membershipRedeem(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The 820px table needs 6x horizontal scrolling at 132px; below
              640px the same memberships render as cards. */}
          {!loading && !loadError && memberships.length > 0 && (
            <CardList>
              {memberships.map((m) => (
                <CardItem key={m._id}>
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2 min-w-0">
                    <p className="font-medium min-w-0 break-words">{m.customerName}</p>
                    <StatusBadge status={m.status} />
                  </div>
                  <dl className="space-y-1">
                    <Row label="Phone">{m.phone}</Row>
                    <Row label="Package">{m.packageId?.name || "—"}</Row>
                    <Row label="Start">{new Date(m.startDate).toLocaleDateString("en-IN")}</Row>
                    <Row label="End">{membershipEnd(m)}</Row>
                    <Row label="Used / Total">{m.servicesUsed?.length || 0}/{m.servicesTotal}</Row>
                  </dl>
                  {m.status === "active" && <div className="mt-3">{membershipRedeem(m, true)}</div>}
                </CardItem>
              ))}
            </CardList>
          )}
        </div>
      </main>
    </div>
  );
}
