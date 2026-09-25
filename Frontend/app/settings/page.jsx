"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";

const TESTS = [
  { type: "confirmation", label: "Test confirmation (WA Marathi)" },
  { type: "no-show", label: "Test no-show reminder" },
  { type: "upsell", label: "Test upsell — Spa ₹300" },
  { type: "membership-expiry", label: "Test membership expiry" },
  { type: "invoice", label: "Test invoice + UPI" },
];

const SALON_TYPES = ["unisex", "men", "women", "spa"];

export default function SettingsPage() {
  const [form, setForm] = useState({
    salonType: "unisex",
    location: "",
    language: "Marathi",
    upiId: "",
    gstNo: "",
    razorpayKey: "",
    whatsappEnabled: true,
  });
  const [whatsappConfigured, setWhatsappConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState("");

  useEffect(() => {
    api
      .get("/auth/settings")
      .then(({ data }) => {
        setForm({
          salonType: data.salonType || "unisex",
          location: data.location || "",
          language: data.language || "Marathi",
          upiId: data.upiId || "",
          gstNo: data.gstNo || "",
          razorpayKey: data.razorpayKey || "",
          whatsappEnabled: data.whatsappEnabled !== false,
        });
        setWhatsappConfigured(Boolean(data.whatsappConfigured));
      })
      .catch(() => setError("Could not load settings — are you signed in?"))
      .finally(() => setLoaded(true));
  }, []);

  async function save(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.put("/auth/settings", {
        salonType: form.salonType,
        location: form.location,
        language: form.language,
        upiId: form.upiId,
        gstNo: form.gstNo,
        razorpayKey: form.razorpayKey,
        whatsappEnabled: form.whatsappEnabled,
      });
      setSavedMsg("Settings saved.");
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function runTest(type) {
    setTestMsg("");
    try {
      const { data } = await api.post("/whatsapp/test", { language: form.language, type });
      setTestMsg(data.msg);
    } catch {
      setTestMsg("Could not reach the WhatsApp test endpoint.");
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1000px] mx-auto px-4 sm:px-6 py-8 grid md:grid-cols-2 gap-6">
        <div className="ledger-panel p-6 min-w-0">
          <h2 className="font-display text-xl mb-4">Salon settings</h2>
          {error && <p className="text-xs mb-3" style={{ color: "#E08076" }}>{error}</p>}
          <form onSubmit={save} className="space-y-4">
            <div>
              <FieldLabel>Language for customer messages</FieldLabel>
              <select className="w-full" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="Marathi">Marathi — 98% open rate</option>
                <option value="Hindi">Hindi</option>
                <option value="English">English</option>
              </select>
            </div>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Salon type</FieldLabel>
                <select className="w-full" value={form.salonType} onChange={(e) => setForm({ ...form, salonType: e.target.value })}>
                  {SALON_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </div>
              <Input label="Location" placeholder="Baner, Pune" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
            </div>
            <Input label="UPI ID" placeholder="yourupi@okicici" value={form.upiId} onChange={(v) => setForm({ ...form, upiId: v })} />
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
              <Input label="GST number" placeholder="27AABCU9603R1ZM" value={form.gstNo} onChange={(v) => setForm({ ...form, gstNo: v })} />
              <Input label="Razorpay key" placeholder="rzp_live_..." value={form.razorpayKey} onChange={(v) => setForm({ ...form, razorpayKey: v })} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ledger-creamDim">
              <input type="checkbox" checked={form.whatsappEnabled} onChange={(e) => setForm({ ...form, whatsappEnabled: e.target.checked })} className="!w-auto" />
              Send WhatsApp messages for bookings
            </label>
            <button disabled={saving || !loaded} className="btn-gold w-full">
              {saving ? "Saving…" : "Save settings"}
            </button>
            {savedMsg && <p className="text-xs" style={{ color: "#7FC79A" }}>{savedMsg}</p>}
          </form>

          <div className="gold-line my-6" />
          <p className="text-xs text-ledger-creamDim leading-relaxed">
            The WhatsApp API token and phone ID are read from the server&apos;s environment
            ({whatsappConfigured ? "configured ✓" : "not configured — messages fall back to preview mode"}).
            Keys are never stored in or returned by the app.
          </p>
        </div>

        <div className="ledger-panel p-6 min-w-0">
          <h2 className="font-display text-xl mb-4">WhatsApp message tests</h2>
          <div className="space-y-2">
            {TESTS.map((t) => (
              <button key={t.type} onClick={() => runTest(t.type)} className="btn-ghost w-full text-left text-sm">
                {t.label}
              </button>
            ))}
          </div>
          {testMsg && <p className="text-xs mt-4" style={{ color: "#E0BD7C" }}>{testMsg}</p>}

          <div className="gold-line my-6" />
          <p className="text-xs text-ledger-creamDim leading-relaxed">
            Setup ₹9,999 + ₹499/mo flat, unlimited staff — vs Calendly at ~₹11,600/mo per seat.
            WhatsApp-first Marathi/Hindi messaging, UPI advance with no-show charge kept, staff
            commission calculated automatically, low-stock and membership-expiry alerts included.
          </p>
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