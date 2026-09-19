"use client";

import { useEffect, useMemo, useState } from "react";
import api, { getSession } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";

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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function BookingsPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [bookings, setBookings] = useState([]);
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

  const selectedService = services.find((s) => s._id === form.serviceId);
  const total = selectedService?.price || 0;
  const discount = offer?.discount || 0;
  const totalAfterDiscount = Math.max(total - discount, 0);
  const advance = Math.round(totalAfterDiscount * 0.2);

  const staffForService = useMemo(() => {
    if (!selectedService) return staff;
    return staff.filter((st) => st.specialization === selectedService.category || !selectedService.category);
  }, [staff, selectedService]);

  function loadBookings() {
    api.get("/bookings/list", { params: { companyId, date } }).then((r) => setBookings(r.data || [])).catch(() => {});
  }

  useEffect(() => {
    api.get("/services/list", { params: { companyId } }).then((r) => setServices(r.data || [])).catch(() => {});
    api.get("/staff/list", { params: { companyId } }).then((r) => setStaff(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => { loadBookings(); }, [date]);

  async function validateOffer() {
    setOfferMsg("");
    if (!form.offerCode) { setOffer(null); return; }
    try {
      const { data } = await api.post("/offers/validate", { code: form.offerCode, serviceId: form.serviceId, total });
      setOffer(data);
      setOfferMsg(`Applied — ₹${data.discount} off`);
    } catch (err) {
      setOffer(null);
      setOfferMsg(err?.response?.data?.msg || "That code isn't valid for this booking.");
    }
  }

  async function submit(e) {
    e.preventDefault();
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
        " · WhatsApp confirmation sent (mock)."
      );
      setForm({ customerName: "", phone: "", email: "", serviceId: "", staffId: "", bookingDate: date, slot: "", paymentMode: "UPI", offerCode: "" });
      setOffer(null);
      setOfferMsg("");
      loadBookings();
    } catch (err) {
      if (err?.response?.status === 409) {
        setError(err.response.data.msg || "That slot is already booked for this staff member.");
      } else {
        setError(err?.response?.data?.msg || "Could not create the booking.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(bookingId, status) {
    try {
      await api.post("/bookings/status", { bookingId, status });
      loadBookings();
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not update the booking.");
    }
  }

  async function sendWhatsapp(bookingId, type) {
    try {
      const { data } = await api.post("/whatsapp/send", { bookingId, type, language: "Marathi" });
      alert(data.message || data.msg);
    } catch {
      alert("Could not send the WhatsApp message.");
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-6 py-8 grid lg:grid-cols-[380px_1fr] gap-6">
        <div className="ledger-panel p-5 h-fit">
          <h2 className="font-display text-xl mb-4">New booking</h2>
          {error && <p className="text-xs mb-3 px-3 py-2" style={{ background: "rgba(193,85,74,0.15)", color: "#E08076" }}>{error}</p>}
          {notice && <p className="text-xs mb-3 px-3 py-2" style={{ background: "rgba(79,154,106,0.15)", color: "#7FC79A" }}>{notice}</p>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Customer name" value={form.customerName} onChange={(v) => setForm({ ...form, customerName: v })} required />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required placeholder="9876543210" />
              <Input label="Email (optional)" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            </div>
            <div>
              <FieldLabel>Service</FieldLabel>
              <select className="w-full" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value, staffId: "" })} required>
                <option value="">Select a service</option>
                {services.map((s) => <option key={s._id} value={s._id}>{s.name} — ₹{s.price}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Staff</FieldLabel>
              <select className="w-full" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} required>
                <option value="">Select staff</option>
                {staffForService.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Date" type="date" value={form.bookingDate} onChange={(v) => setForm({ ...form, bookingDate: v })} required />
              <div>
                <FieldLabel>Slot</FieldLabel>
                <select className="w-full" value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })} required>
                  <option value="">Select slot</option>
                  {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <FieldLabel>Payment mode</FieldLabel>
              <select className="w-full" value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Razorpay">Razorpay</option>
              </select>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input label="Offer code" value={form.offerCode} onChange={(v) => { setForm({ ...form, offerCode: v }); setOffer(null); setOfferMsg(""); }} placeholder="DIWALI20" />
              </div>
              <button type="button" onClick={validateOffer} className="btn-ghost text-xs h-[38px]">Validate</button>
            </div>
            {offerMsg && <p className="text-xs" style={{ color: offer ? "#7FC79A" : "#E08076" }}>{offerMsg}</p>}

            {selectedService && (
              <div className="gold-line my-3" />
            )}
            {selectedService && (
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-ledger-creamDim">Total</span><span>₹{total}</span></div>
                {discount > 0 && <div className="flex justify-between"><span className="text-ledger-creamDim">Discount</span><span style={{ color: "#7FC79A" }}>−₹{discount}</span></div>}
                <div className="flex justify-between font-semibold"><span>Advance (20%)</span><span className="text-ledger-gold">₹{advance}</span></div>
              </div>
            )}

            <button disabled={saving} className="btn-gold w-full mt-2">{saving ? "Booking…" : "Book now"}</button>
          </form>
        </div>

        <div className="ledger-panel">
          <div className="px-5 py-4 ledger-rule flex items-center justify-between">
            <h2 className="font-display text-xl">Bookings</h2>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-xs" />
          </div>
          {bookings.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No bookings for this date — create the first one.</p>
          ) : (
            <table className="ledger-table w-full">
              <thead>
                <tr><th>Customer</th><th>Service</th><th>Staff</th><th>Slot</th><th>Advance</th><th>Total</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b._id}>
                    <td>{b.customerName}<div className="text-xs text-ledger-creamDim">{b.phone}</div></td>
                    <td>{b.serviceId?.name || "—"}<div className="text-xs text-ledger-creamDim capitalize">{b.serviceId?.category}</div></td>
                    <td>{b.staffId?.name || "—"}<div className="text-xs text-ledger-creamDim">{b.staffId?.commissionPercent}% commission</div></td>
                    <td>{b.slot}</td>
                    <td>₹{b.advancePaid}</td>
                    <td>₹{b.total}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {b.status === "booked" && (
                          <>
                            <button onClick={() => setStatus(b._id, "completed")} className="btn-ghost text-xs !py-1">Complete</button>
                            <button onClick={() => setStatus(b._id, "no-show")} className="btn-ghost text-xs !py-1">No-show</button>
                          </>
                        )}
                        <button onClick={() => sendWhatsapp(b._id, "confirmation")} className="btn-ghost text-xs !py-1">WA</button>
                        <button onClick={() => sendWhatsapp(b._id, "upsell")} className="btn-ghost text-xs !py-1">Upsell</button>
                      </div>
                    </td>
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
