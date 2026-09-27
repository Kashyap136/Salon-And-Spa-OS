"use client";

import { useEffect, useMemo, useState } from "react";
import api, { fileUrl, apiErrorMessage } from "@/lib/api";
import { todayStr } from "@/lib/date";
import Alert from "@/components/Alert";

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

/** Visible label + control, wired for screen readers. */
function Labelled({ label, children }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

export default function PublicSalonPage({ params }) {
  const { subdomain } = params;
  const [company, setCompany] = useState(null);
  const [services, setServices] = useState([]);
  const [packages, setPackages] = useState([]);
  const [offers, setOffers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  // Set when the required stylist list could not be loaded. The booking form
  // is unusable without it, so this must be visible rather than an empty select.
  const [staffError, setStaffError] = useState("");

  const [form, setForm] = useState({
    customerName: "", phone: "", email: "", serviceId: "", staffId: "",
    bookingDate: todayStr(), slot: "", paymentMode: "UPI", offerCode: "",
  });
  const [offer, setOffer] = useState(null);
  const [offerMsg, setOfferMsg] = useState("");
  const [offerBusy, setOfferBusy] = useState(false);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const [lead, setLead] = useState({ name: "", phone: "", message: "" });
  const [leadSent, setLeadSent] = useState(false);
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setStaffError("");

    (async () => {
      try {
        const [svc, pkg] = await Promise.all([
          api.get("/services/public", { params: { subdomain } }),
          api.get("/packages/public", { params: { subdomain } }),
        ]);
        if (cancelled) return;
        setCompany(svc.data?.company || null);
        setServices(Array.isArray(svc.data?.services) ? svc.data.services : []);
        setPackages(Array.isArray(pkg.data?.packages) ? pkg.data.packages : []);

        const companyId = svc.data?.company?._id;
        if (!companyId) return;

        // These MUST be the public catalog routes. /offers/list and /staff/list
        // are authRequired: they returned 401, the empty lists were swallowed,
        // and the required stylist dropdown was silently empty. Worse, for a
        // signed-in visitor the Authorization header made those authed routes
        // return the *logged-in* salon's data, so one salon's public page
        // displayed another salon's team and coupons.
        const [off, stf] = await Promise.allSettled([
          api.get("/offers/public", { params: { companyId } }),
          api.get("/staff/public", { params: { subdomain } }),
        ]);
        if (cancelled) return;

        setOffers(off.status === "fulfilled" && Array.isArray(off.value.data?.offers) ? off.value.data.offers : []);
        if (stf.status === "fulfilled" && Array.isArray(stf.value.data?.staff)) {
          setStaff(stf.value.data.staff);
        } else {
          setStaff([]);
          setStaffError(
            "We couldn't load the stylist list, so booking is unavailable right now. Please call the salon."
          );
        }
      } catch {
        if (!cancelled) setError("We couldn't find this salon. Check the link and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
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
    if (offerBusy) return;
    setOfferMsg("");
    if (!form.offerCode) { setOffer(null); return; }
    if (!form.serviceId) {
      setOffer(null);
      setOfferMsg("Choose a service first.");
      return;
    }
    setOfferBusy(true);
    try {
      const { data } = await api.post("/offers/validate", { code: form.offerCode, serviceId: form.serviceId, total });
      setOffer(data);
      setOfferMsg(`Applied — ₹${data.discount} off`);
    } catch (err) {
      setOffer(null);
      setOfferMsg(apiErrorMessage(err, "This code isn't valid right now."));
    } finally {
      setOfferBusy(false);
    }
  }

  async function submitBooking(e) {
    e.preventDefault();
    if (booking) return;
    setError("");
    setBooking(true);
    try {
      const { data } = await api.post("/bookings/public/create", {
        companyId: company._id, ...form, offerId: offer?.offerId,
      });
      setResult({ advancePaid: data.advancePaid, slot: form.slot });
    } catch (err) {
      if (err?.response?.status === 409) setError(err.response.data.msg);
      else setError(apiErrorMessage(err, "Could not complete the booking. Please try again."));
    } finally {
      setBooking(false);
    }
  }

  async function submitLead(e) {
    e.preventDefault();
    if (leadBusy) return;
    setLeadError("");
    setLeadBusy(true);
    try {
      await api.post("/leads/create", { companyId: company._id, ...lead, source: "public" });
      setLeadSent(true);
      setLead({ name: "", phone: "", message: "" });
    } catch (err) {
      setLeadError(apiErrorMessage(err, "Could not send your message — please call the salon directly."));
    } finally {
      setLeadBusy(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-ledger-creamDim" role="status">Opening the book…</div>;
  }
  if (error && !company) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" role="alert">
        <Alert>{error}</Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="border-b border-ledger-gold/20 page py-12 sm:py-16 text-center">
        <p className="text-xs tracking-wide text-ledger-gold mb-3 break-words">{company?.location}</p>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl max-tiny:text-2xl text-ledger-cream mb-4 break-words">{company?.name}</h1>
        <p className="text-ledger-creamDim max-w-md mx-auto px-2">
          Book your appointment below — confirmation and reminders sent straight to WhatsApp.
        </p>
      </section>

      <main className="page max-w-[1200px] mx-auto py-12 grid lg:grid-cols-[1fr_420px] gap-10 min-w-0">
        <div className="space-y-12 min-w-0">
          {/* Services */}
          <div>
            <h2 className="panel-title mb-4">Services</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {services.map((s) => (
                <div key={s._id} className="ledger-panel panel-pad min-w-0">
                  {s.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(s.imageUrl)} alt={s.name} className="w-full h-32 object-cover rounded mb-3" />
                  )}
                  <div className="flex flex-wrap justify-between items-baseline gap-x-2 gap-y-0.5">
                    <p className="font-medium min-w-0 break-words">{s.name}</p>
                    <p className="text-ledger-gold shrink-0">₹{s.price}</p>
                  </div>
                  <p className="text-xs text-ledger-creamDim mt-1 capitalize">{s.category} · {s.durationMins} min</p>
                </div>
              ))}
            </div>
          </div>

          {/* Packages */}
          {packages.length > 0 && (
            <div>
              <h2 className="panel-title mb-4">Packages</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {packages.map((p) => (
                  <div key={p._id} className="ledger-panel panel-pad min-w-0">
                    <p className="font-medium break-words">{p.name}</p>
                    <div className="flex flex-wrap items-baseline gap-2 mt-1">
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
              <h2 className="panel-title mb-4">Offers</h2>
              <div className="flex flex-wrap gap-3">
                {offers.map((o) => (
                  <div key={o._id} className="ledger-panel px-4 py-3 max-w-full min-w-0">
                    <p className="text-ledger-gold font-semibold text-sm break-words">{o.code}</p>
                    <p className="text-xs text-ledger-creamDim break-words">{o.title}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Staff */}
          {staff.length > 0 && (
            <div>
              <h2 className="panel-title mb-4">Our team</h2>
              <div className="flex flex-wrap gap-4">
                {staff.map((s) => (
                  <div key={s._id} className="text-center min-w-0 max-w-full">
                    {s.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(s.photoUrl)} alt={s.name} className="w-16 h-16 rounded-full object-cover mx-auto" />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-ledger-panelLight mx-auto" />
                    )}
                    <p className="text-sm mt-2 break-words">{s.name}</p>
                    <p className="text-xs text-ledger-creamDim capitalize break-words">{s.specialization}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inquiry */}
          <div className="ledger-panel panel-pad min-w-0">
            <h2 className="panel-title mb-3">Have a question?</h2>
            {leadSent ? (
              <p className="text-sm" style={{ color: "#7FC79A" }}>Thanks — we&apos;ll follow up on WhatsApp shortly.</p>
            ) : (
              <form onSubmit={submitLead} className="grid sm:grid-cols-3 gap-3">
                <Labelled label="Name">
                  <input
                    name="lead-name"
                    autoComplete="name"
                    value={lead.name}
                    onChange={(e) => setLead({ ...lead, name: e.target.value })}
                    required
                    className="w-full"
                  />
                </Labelled>
                <Labelled label="Phone">
                  <input
                    name="lead-phone"
                    type="tel"
                    autoComplete="tel"
                    value={lead.phone}
                    onChange={(e) => setLead({ ...lead, phone: e.target.value })}
                    required
                    className="w-full"
                  />
                </Labelled>
                <Labelled label="Message (optional)">
                  <div className="action-row">
                    <input
                      name="lead-message"
                      value={lead.message}
                      onChange={(e) => setLead({ ...lead, message: e.target.value })}
                      className="w-full min-w-0"
                    />
                    <button type="submit" disabled={leadBusy} className="btn-ghost text-xs">
                      {leadBusy ? "…" : "Send"}
                    </button>
                  </div>
                </Labelled>
                {leadError && <Alert className="sm:col-span-3">{leadError}</Alert>}
              </form>
            )}
          </div>
        </div>

        {/* Booking form */}
        <div className="ledger-panel panel-pad-lg h-fit sticky top-8 min-w-0">
          <h2 className="panel-title mb-4">Book now</h2>
          {result ? (
            <div className="space-y-3">
              <Alert tone="success">
                Booked! Advance ₹{result.advancePaid} for slot {result.slot}. A WhatsApp confirmation with the location map is on its way.
              </Alert>
              <a href={upiLink} className="btn-gold block text-center">Pay advance via UPI</a>
              {company?.location && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(company.location)}`} target="_blank" rel="noreferrer" className="btn-ghost block text-center text-sm">
                  Open location in Maps
                </a>
              )}
            </div>
          ) : (
            <form onSubmit={submitBooking} className="space-y-3">
              {error && <Alert>{error}</Alert>}
              {staffError && <Alert>{staffError}</Alert>}
              <Labelled label="Your name">
                <input
                  name="customerName"
                  autoComplete="name"
                  value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  required
                  className="w-full"
                />
              </Labelled>
              <Labelled label="Phone">
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                  className="w-full"
                />
              </Labelled>
              <Labelled label="Email (optional)">
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full"
                />
              </Labelled>
              <Labelled label="Service">
                <select
                  className="w-full"
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value, staffId: "", offerCode: "" })}
                  required
                >
                  <option value="">Choose a service</option>
                  {services.map((s) => <option key={s._id} value={s._id}>{s.name} — ₹{s.price}</option>)}
                </select>
              </Labelled>
              <Labelled label="Stylist">
                <select
                  className="w-full"
                  value={form.staffId}
                  onChange={(e) => setForm({ ...form, staffId: e.target.value })}
                  required
                  disabled={staff.length === 0}
                >
                  <option value="">{staff.length === 0 ? "No stylists available" : "Choose a stylist"}</option>
                  {staffForService.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </Labelled>
              {selectedService && staff.length > 0 && staffForService.length === 0 && (
                <p className="text-xs break-words" style={{ color: "#E0BD7C" }}>
                  No {selectedService.category} stylist is available right now — try another service.
                </p>
              )}
              <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
                <Labelled label="Date">
                  <input
                    type="date"
                    min={todayStr()}
                    value={form.bookingDate}
                    onChange={(e) => setForm({ ...form, bookingDate: e.target.value })}
                    required
                    className="w-full"
                  />
                </Labelled>
                <Labelled label="Time slot">
                  <select
                    value={form.slot}
                    onChange={(e) => setForm({ ...form, slot: e.target.value })}
                    required
                    className="w-full"
                  >
                    <option value="">Slot</option>
                    {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Labelled>
              </div>
              <Labelled label="Payment mode">
                <select
                  value={form.paymentMode}
                  onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                  className="w-full"
                >
                  <option value="UPI">UPI</option>
                  <option value="Cash">Cash</option>
                  <option value="Razorpay">Razorpay</option>
                </select>
              </Labelled>
              <Labelled label="Offer code (optional)">
                <div className="action-row">
                  <input
                    name="offerCode"
                    value={form.offerCode}
                    onChange={(e) => { setForm({ ...form, offerCode: e.target.value }); setOffer(null); setOfferMsg(""); }}
                    className="w-full min-w-0"
                  />
                  <button type="button" onClick={validateOffer} disabled={offerBusy} className="btn-ghost text-xs">
                    {offerBusy ? "…" : "Apply"}
                  </button>
                </div>
              </Labelled>
              {offerMsg && (
                <p className="text-xs break-words" role="status" aria-live="polite" style={{ color: offer ? "#7FC79A" : "#E08076" }}>
                  {offerMsg}
                </p>
              )}

              {selectedService && (
                <>
                  <div className="gold-line my-2" />
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between gap-3"><span className="text-ledger-creamDim min-w-0">Total</span><span className="shrink-0">₹{total}</span></div>
                    {discount > 0 && <div className="flex justify-between gap-3"><span className="text-ledger-creamDim min-w-0">Discount</span><span className="shrink-0" style={{ color: "#7FC79A" }}>−₹{discount}</span></div>}
                    <div className="flex justify-between gap-3 font-semibold"><span className="min-w-0">Advance (20%)</span><span className="text-ledger-gold shrink-0">₹{advance}</span></div>
                  </div>
                </>
              )}
              <button type="submit" disabled={booking || staffError} className="btn-gold w-full mt-2">
                {booking ? "Booking…" : "Book & pay advance"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
