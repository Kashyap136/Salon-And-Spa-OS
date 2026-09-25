"use client";

import { useEffect, useMemo, useState } from "react";
import api, { fileUrl } from "@/lib/api";

function buildSlots() {
  const slots = [];
  for (let h = 9; h < 20; h++) {
    for (const m of [0, 30]) {
      const start = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const endH = m === 30 ? h + 1 : h;
      const endM = m === 30 ? 0 : 30;
      slots.push(`${start}-${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`);
    }
  }
  return slots;
}
const SLOTS = buildSlots();

export default function PublicSalonPage({ params }) {
  const { subdomain } = params;
  const [company, setCompany] = useState(null);
  const [services, setServices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [offers, setOffers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    customerName: "", phone: "", email: "", serviceId: "", staffId: "",
    bookingDate: new Date().toISOString().slice(0, 10), slot: "", paymentMode: "UPI", offerCode: "",
  });
  const [offer, setOffer] = useState(null);
  const [offerMsg, setOfferMsg] = useState("");
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [lead, setLead] = useState({ name: "", phone: "", message: "" });
  const [leadSent, setLeadSent] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/services/public", { params: { subdomain } }),
      api.get("/packages/public", { params: { subdomain } }),
    ])
      .then(([svc, pkg]) => {
        setCompany(svc.data.company);
        setServices(svc.data.services || []);
        setPackages(pkg.data.packages || []);
        if (svc.data.company?._id) {
          api.get("/offers/list", { params: { companyId: svc.data.company._id, isActive: true } })
            .then((r) => setOffers(r.data || []))
            .catch(() => {});
          api.get("/staff/list", { params: { companyId: svc.data.company._id } })
            .then((r) => setStaff(r.data || []))
            .catch(() => {});
        }
      })
      .catch(() => setError("We couldn't find this salon. Check the link and try again."))
      .finally(() => setLoading(false));
  }, [subdomain]);

  const selectedService = services.find((s) => s._id === form.serviceId);
  const total = selectedService?.price || 0;
  const discount = offer?.discount || 0;
  const totalAfterDiscount = Math.max(total - discount, 0);
  const advance = Math.round(totalAfterDiscount * 0.2);
  const upiId = company?.upiId || "salon@upi";
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&am=${encodeURIComponent(advance)}&cu=INR`;

  const staffForService = useMemo(() => {
    if (!selectedService) return staff;
    return staff.filter((st) => st.specialization === selectedService.category);
  }, [staff, selectedService]);

  async function validateOffer() {
    setOfferMsg("");
    if (!form.offerCode) { setOffer(null); return; }
    try {
      const { data } = await api.post("/offers/validate", { code: form.offerCode, serviceId: form.serviceId, total });
      setOffer(data);
      setOfferMsg(`Applied — ₹${data.discount} off`);
    } catch (err) {
      setOffer(null);
      setOfferMsg(err?.response?.data?.msg || "This code isn't valid right now.");
    }
  }

  async function submitBooking(e) {
    e.preventDefault();
    setError("");
    setBooking(true);
    try {
      const { data } = await api.post("/bookings/public/create", {
        companyId: company._id, ...form, offerId: offer?.offerId,
      });
      setResult({ advancePaid: data.advancePaid, slot: form.slot });
    } catch (err) {
      if (err?.response?.status === 409) setError(err.response.data.msg);
      else setError(err?.response?.data?.msg || "Could not complete the booking. Please try again.");
    } finally {
      setBooking(false);
    }
  }

  async function submitLead(e) {
    e.preventDefault();
    try {
      await api.post("/leads/create", { companyId: company._id, ...lead, source: "public" });
      setLeadSent(true);
      setLead({ name: "", phone: "", message: "" });
    } catch {
      alert("Could not send your message — please call the salon directly.");
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-ledger-creamDim">Opening the book…</div>;
  }
  if (error && !company) {
    return <div className="min-h-screen flex items-center justify-center text-ledger-creamDim">{error}</div>;
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="border-b border-ledger-gold/20 px-4 sm:px-6 py-12 sm:py-16 text-center">
        <p className="text-xs tracking-wide text-ledger-gold mb-3 break-words">{company?.location}</p>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl text-ledger-cream mb-4 break-words">{company?.name}</h1>
        <p className="text-ledger-creamDim max-w-md mx-auto px-2">
          Book your appointment below — confirmation and reminders sent straight to WhatsApp.
        </p>
      </section>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12 grid lg:grid-cols-[1fr_420px] gap-10">
        <div className="space-y-12">
          {/* Services */}
          <div>
            <h2 className="font-display text-2xl mb-4">Services</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {services.map((s) => (
                <div key={s._id} className="ledger-panel p-4">
                  {s.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(s.imageUrl)} alt={s.name} className="w-full h-32 object-cover rounded mb-3" />
                  )}
                  <div className="flex justify-between items-baseline">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-ledger-gold">₹{s.price}</p>
                  </div>
                  <p className="text-xs text-ledger-creamDim mt-1 capitalize">{s.category} · {s.durationMins} min</p>
                </div>
              ))}
            </div>
          </div>

          {/* Packages */}
          {packages.length > 0 && (
            <div>
              <h2 className="font-display text-2xl mb-4">Packages</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {packages.map((p) => (
                  <div key={p._id} className="ledger-panel p-4">
                    <p className="font-medium">{p.name}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="line-through text-ledger-creamDim text-sm">₹{p.originalPrice}</span>
                      <span className="text-ledger-gold font-semibold">₹{p.price}</span>
                      <span className="text-xs" style={{ color: "#7FC79A" }}>Save ₹{p.savings}</span>
                    </div>
                    <p className="text-xs text-ledger-creamDim mt-1">{p.services?.length || 0} services · valid {p.validityDays} days</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Offers */}
          {offers.length > 0 && (
            <div>
              <h2 className="font-display text-2xl mb-4">Offers</h2>
              <div className="flex flex-wrap gap-3">
                {offers.map((o) => (
                  <div key={o._id} className="ledger-panel px-4 py-3">
                    <p className="text-ledger-gold font-semibold text-sm">{o.code}</p>
                    <p className="text-xs text-ledger-creamDim">{o.title}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Staff */}
          {staff.length > 0 && (
            <div>
              <h2 className="font-display text-2xl mb-4">Our team</h2>
              <div className="flex flex-wrap gap-4">
                {staff.map((s) => (
                  <div key={s._id} className="text-center">
                    {s.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(s.photoUrl)} alt={s.name} className="w-16 h-16 rounded-full object-cover mx-auto" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-ledger-panelLight mx-auto" />
                    )}
                    <p className="text-sm mt-2">{s.name}</p>
                    <p className="text-xs text-ledger-creamDim capitalize">{s.specialization}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inquiry */}
          <div className="ledger-panel p-5">
            <h2 className="font-display text-xl mb-3">Have a question first?</h2>
            {leadSent ? (
              <p className="text-sm" style={{ color: "#7FC79A" }}>Thanks — we&apos;ll follow up on WhatsApp shortly.</p>
            ) : (
              <form onSubmit={submitLead} className="grid sm:grid-cols-3 gap-3">
                <input placeholder="Name" value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} required />
                <input placeholder="Phone" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} required />
                <div className="flex gap-2">
                  <input placeholder="Message" value={lead.message} onChange={(e) => setLead({ ...lead, message: e.target.value })} className="flex-1" />
                  <button className="btn-ghost text-xs">Send</button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Booking form */}
        <div className="ledger-panel p-6 h-fit sticky top-8">
          <h2 className="font-display text-2xl mb-4">Book now</h2>
          {result ? (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "#7FC79A" }}>
                Booked! Advance ₹{result.advancePaid} for slot {result.slot}. A WhatsApp confirmation with the location map is on its way.
              </p>
              <a href={upiLink} className="btn-gold block text-center">Pay advance via UPI</a>
              {company?.location && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(company.location)}`} target="_blank" rel="noreferrer" className="btn-ghost block text-center text-sm">
                  Open location in Maps
                </a>
              )}
            </div>
          ) : (
            <form onSubmit={submitBooking} className="space-y-3">
              {error && <p className="text-xs px-3 py-2" style={{ background: "rgba(193,85,74,0.15)", color: "#E08076" }}>{error}</p>}
              <input placeholder="Your name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required className="w-full" />
              <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required className="w-full" />
              <input placeholder="Email (optional)" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full" />
              <select className="w-full" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value, staffId: "" })} required>
                <option value="">Choose a service</option>
                {services.map((s) => <option key={s._id} value={s._id}>{s.name} — ₹{s.price}</option>)}
              </select>
              <select className="w-full" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} required>
                <option value="">Choose staff</option>
                {staffForService.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                <input type="date" value={form.bookingDate} onChange={(e) => setForm({ ...form, bookingDate: e.target.value })} required className="w-full" />
                <select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })} required className="w-full">
                  <option value="">Slot</option>
                  {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })} className="w-full">
                <option value="UPI">UPI</option>
                <option value="Cash">Cash</option>
                <option value="Razorpay">Razorpay</option>
              </select>
              <div className="flex gap-2">
                <input placeholder="Offer code" value={form.offerCode} onChange={(e) => { setForm({ ...form, offerCode: e.target.value }); setOffer(null); setOfferMsg(""); }} className="flex-1" />
                <button type="button" onClick={validateOffer} className="btn-ghost text-xs">Apply</button>
              </div>
              {offerMsg && <p className="text-xs" style={{ color: offer ? "#7FC79A" : "#E08076" }}>{offerMsg}</p>}

              {selectedService && (
                <>
                  <div className="gold-line my-2" />
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-ledger-creamDim">Total</span><span>₹{total}</span></div>
                    {discount > 0 && <div className="flex justify-between"><span className="text-ledger-creamDim">Discount</span><span style={{ color: "#7FC79A" }}>−₹{discount}</span></div>}
                    <div className="flex justify-between font-semibold"><span>Advance (20%)</span><span className="text-ledger-gold">₹{advance}</span></div>
                  </div>
                </>
              )}
              <button disabled={booking} className="btn-gold w-full mt-2">{booking ? "Booking…" : "Book & pay advance"}</button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
