"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import api, { getSession, apiErrorMessage } from "@/lib/api";
import { todayStr } from "@/lib/date";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import Alert from "@/components/Alert";
import { FieldLabel, Input } from "@/components/Field";
import { CardList, CardItem, Row } from "@/components/DataCard";

function buildSlots() {
  const slots = [];
  for (let h = 9; h < 20; h++) {
    for (const m of [0, 30]) {
      const start = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const endH = m === 30 ? h + 1 : h;
      const endM = m === 30 ? 0 : 30;
      const end = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
      slots.push(`${start}-${end}`);
    }
  }
  return slots;
}
const SLOTS = buildSlots();

export default function BookingsPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [date, setDate] = useState(todayStr());
  const [form, setForm] = useState({
    customerName: "", phone: "", email: "", serviceId: "", staffId: "",
    bookingDate: todayStr(), slot: "", paymentMode: "UPI", offerCode: "",
  });
  const [offer, setOffer] = useState(null);
  const [offerMsg, setOfferMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // One in-flight key per row mutation — without it a double-click on
  // "Complete" issued two status calls (the backend dedupes, but the UI
  // silently fired the duplicate request and showed no feedback).
  const [busyId, setBusyId] = useState(null);

  const selectedService = services.find((s) => s._id === form.serviceId);
  const total = selectedService?.price || 0;
  const discount = offer?.discount || 0;
  const totalAfterDiscount = Math.max(total - discount, 0);
  const advance = Math.round(totalAfterDiscount * 0.2);

  const staffForService = useMemo(() => {
    if (!selectedService) return staff;
    return staff.filter((st) => st.specialization === selectedService.category || !selectedService.category);
  }, [staff, selectedService]);

  const loadBookings = useCallback(() => {
    setLoading(true);
    api.get("/bookings/list", { params: { companyId, date } })
      .then((r) => { setBookings(Array.isArray(r.data) ? r.data : []); setLoadError(""); })
      .catch((err) => { setBookings([]); setLoadError(apiErrorMessage(err, "Could not load bookings.")); })
      .finally(() => setLoading(false));
  }, [companyId, date]);

  useEffect(() => {
    api.get("/services/list", { params: { companyId } })
      .then((r) => setServices(Array.isArray(r.data) ? r.data : []))
      .catch((err) => setError(apiErrorMessage(err, "Could not load services.")));
    api.get("/staff/list", { params: { companyId } })
      .then((r) => setStaff(Array.isArray(r.data) ? r.data : []))
      .catch((err) => setError(apiErrorMessage(err, "Could not load staff.")));
  }, [companyId]);

  useEffect(() => { loadBookings(); }, [loadBookings]);

  async function validateOffer() {
    setOfferMsg("");
    if (!form.offerCode) { setOffer(null); return; }
    try {
      const { data } = await api.post("/offers/validate", { code: form.offerCode, serviceId: form.serviceId, total });
      setOffer(data);
      setOfferMsg(`Applied — ₹${data.discount} off`);
    } catch (err) {
      setOffer(null);
      setOfferMsg(apiErrorMessage(err, "That code isn't valid for this booking."));
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const { data } = await api.post("/bookings/create", {
        companyId,
        ...form,
        offerId: offer?.offerId,
      });
      setNotice(
        `Booked — ${form.customerName}. Advance ₹${data.advancePaid} · Slot ${form.slot}` +
        (discount ? ` · Discount ₹${discount} applied` : "") +
        " · WhatsApp confirmation sent."
      );
      setForm({ customerName: "", phone: "", email: "", serviceId: "", staffId: "", bookingDate: date, slot: "", paymentMode: "UPI", offerCode: "" });
      setOffer(null);
      setOfferMsg("");
      loadBookings();
    } catch (err) {
      if (err?.response?.status === 409) {
        setError(err.response.data.msg || "That slot is already booked for this staff member.");
      } else {
        setError(apiErrorMessage(err, "Could not create the booking."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(bookingId, status) {
    if (busyId) return;
    setError("");
    setNotice("");
    setBusyId(`${bookingId}:${status}`);
    try {
      const { data } = await api.post("/bookings/status", { bookingId, status });
      setNotice(data.message || `Booking marked ${status}.`);
      loadBookings();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not update the booking."));
    } finally {
      setBusyId(null);
    }
  }

  async function sendWhatsapp(bookingId, type) {
    if (busyId) return;
    setError("");
    setNotice("");
    setBusyId(`${bookingId}:${type}`);
    try {
      const { data } = await api.post("/whatsapp/send", { bookingId, type, language: "Marathi" });
      setNotice(data.message || data.msg || "WhatsApp message queued.");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send the WhatsApp message."));
    } finally {
      setBusyId(null);
    }
  }

  // Shared by the table's Actions cell and the narrow-width card list, so the
  // two presentations can never drift apart.
  function bookingActions(b) {
    return (
      <>
        {b.status === "booked" && (
          <>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => setStatus(b._id, "completed")}
              className="btn-ghost text-xs !py-1 min-w-[44px]"
            >
              {busyId === `${b._id}:completed` ? "…" : "Complete"}
            </button>
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => setStatus(b._id, "no-show")}
              className="btn-ghost text-xs !py-1 min-w-[44px]"
            >
              {busyId === `${b._id}:no-show` ? "…" : "No-show"}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={Boolean(busyId)}
          onClick={() => sendWhatsapp(b._id, "confirmation")}
          className="btn-ghost text-xs !py-1 min-w-[44px]"
          aria-label={`Send WhatsApp confirmation to ${b.customerName}`}
        >
          {busyId === `${b._id}:confirmation` ? "…" : "WA"}
        </button>
        <button
          type="button"
          disabled={Boolean(busyId)}
          onClick={() => sendWhatsapp(b._id, "upsell")}
          className="btn-ghost text-xs !py-1 min-w-[44px]"
          aria-label={`Send WhatsApp upsell to ${b.customerName}`}
        >
          {busyId === `${b._id}:upsell` ? "…" : "Upsell"}
        </button>
      </>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 grid lg:grid-cols-[380px_1fr] gap-6">
      {/* Page-level heading for assistive tech; the visible card headings are
          h2s underneath it. */}
      <h1 className="sr-only">Bookings</h1>
        <div className="ledger-panel panel-pad h-fit min-w-0">
          <h2 className="panel-title mb-4">New booking</h2>
          {error && <Alert className="mb-3">{error}</Alert>}
          {notice && <Alert tone="success" className="mb-3">{notice}</Alert>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Customer name" value={form.customerName} onChange={(v) => setForm({ ...form, customerName: v })} required />
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required placeholder="9876543210" />
              <Input label="Email (optional)" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            </div>
            <div>
              <FieldLabel>Service</FieldLabel>
              <select
                className="w-full"
                aria-label="Service"
                value={form.serviceId}
                onChange={(e) => setForm({ ...form, serviceId: e.target.value, staffId: "" })}
                required
              >
                <option value="">Select a service</option>
                {services.map((s) => <option key={s._id} value={s._id}>{s.name} — ₹{s.price}</option>)}
              </select>
              {services.length === 0 && (
                <p className="text-xs text-ledger-creamDim mt-1 break-words">No services yet — add one under Services first.</p>
              )}
            </div>
            <div>
              <FieldLabel>Staff</FieldLabel>
              <select
                className="w-full"
                aria-label="Staff"
                value={form.staffId}
                onChange={(e) => setForm({ ...form, staffId: e.target.value })}
                required
              >
                <option value="">Select staff</option>
                {staffForService.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
              {selectedService && staffForService.length === 0 && (
                <p className="text-xs mt-1" style={{ color: "#E0BD7C" }}>
                  No {selectedService.category} staff member yet.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="Date" type="date" min={todayStr()} value={form.bookingDate} onChange={(v) => setForm({ ...form, bookingDate: v })} required />
              <div>
                <FieldLabel>Slot</FieldLabel>
                <select className="w-full" aria-label="Time slot" value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })} required>
                  <option value="">Select slot</option>
                  {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <FieldLabel>Payment mode</FieldLabel>
              <select className="w-full" aria-label="Payment mode" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Razorpay">Razorpay</option>
              </select>
            </div>
            <div className="action-row">
              <Input label="Offer code" value={form.offerCode} onChange={(v) => { setForm({ ...form, offerCode: v }); setOffer(null); setOfferMsg(""); }} placeholder="DIWALI20" />
              <button type="button" onClick={validateOffer} className="btn-ghost text-xs h-[38px]">Validate</button>
            </div>
            {offerMsg && <p className="text-xs break-words" role="status" aria-live="polite" style={{ color: offer ? "#7FC79A" : "#E08076" }}>{offerMsg}</p>}

            {selectedService && (
              <div className="gold-line my-3" />
            )}
            {selectedService && (
              <div className="text-sm space-y-1">
                <div className="flex justify-between gap-3"><span className="text-ledger-creamDim min-w-0">Total</span><span className="shrink-0">₹{total}</span></div>
                {discount > 0 && <div className="flex justify-between gap-3"><span className="text-ledger-creamDim min-w-0">Discount</span><span className="shrink-0" style={{ color: "#7FC79A" }}>−₹{discount}</span></div>}
                <div className="flex justify-between gap-3 font-semibold"><span className="min-w-0">Advance (20%)</span><span className="text-ledger-gold shrink-0">₹{advance}</span></div>
              </div>
            )}

            <button type="submit" disabled={saving} className="btn-gold w-full mt-2">{saving ? "Booking…" : "Book now"}</button>
          </form>
        </div>

        <div className="ledger-panel min-w-0">
          <div className="panel-head ledger-rule flex items-center justify-between flex-wrap gap-3">
            <h2 className="panel-title">Bookings</h2>
            <label className="inline-field text-xs">
              <span className="text-ledger-creamDim shrink-0">Date</span>
              <input
                type="date"
                aria-label="Filter bookings by date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="text-xs min-w-0 max-w-full"
              />
            </label>
          </div>
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading bookings…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button onClick={loadBookings} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : bookings.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">No bookings for this date — create the first one.</p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[820px]">
              <thead>
                <tr><th>Customer</th><th>Service</th><th>Staff</th><th>Slot</th><th>Advance</th><th>Total</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b._id}>
                    <td className="break-words">{b.customerName}<div className="text-xs text-ledger-creamDim">{b.phone}</div></td>
                    <td>{b.serviceId?.name || "—"}<div className="text-xs text-ledger-creamDim capitalize">{b.serviceId?.category}</div></td>
                    <td>{b.staffId?.name || "—"}<div className="text-xs text-ledger-creamDim">{b.staffId?.commissionPercent}% commission</div></td>
                    <td>{b.slot}</td>
                    <td>₹{b.advancePaid}</td>
                    <td>₹{b.total}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>
                      <div className="flex flex-wrap gap-1">{bookingActions(b)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          {/* Below 640px the 820px table would need 3x horizontal scrolling at
              320px and 7x at 132px, so the same rows render as cards. */}
          {!loading && !loadError && bookings.length > 0 && (
            <CardList>
              {bookings.map((b) => (
                <CardItem key={b._id}>
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2 min-w-0">
                    <p className="font-medium min-w-0 break-words">{b.customerName}</p>
                    <StatusBadge status={b.status} />
                  </div>
                  <dl className="space-y-1">
                    <Row label="Phone">{b.phone}</Row>
                    <Row label="Service">
                      {b.serviceId?.name || "—"}
                      <span className="block text-xs text-ledger-creamDim capitalize">{b.serviceId?.category}</span>
                    </Row>
                    <Row label="Staff">
                      {b.staffId?.name || "—"}
                      <span className="block text-xs text-ledger-creamDim">{b.staffId?.commissionPercent}% commission</span>
                    </Row>
                    <Row label="Slot">{b.slot}</Row>
                    <Row label="Advance">₹{b.advancePaid}</Row>
                    <Row label="Total">₹{b.total}</Row>
                  </dl>
                  <div className="flex flex-wrap gap-1 mt-3">{bookingActions(b)}</div>
                </CardItem>
              ))}
            </CardList>
          )}
        </div>
      </main>
    </div>
  );
}
