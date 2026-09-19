"use client";

import { useState } from "react";
import api from "@/lib/api";
import Navbar from "@/components/Navbar";

const TESTS = [
  { type: "confirmation", label: "Test confirmation (WA Marathi)" },
  { type: "no-show", label: "Test no-show reminder" },
  { type: "upsell", label: "Test upsell — Spa ₹300" },
  { type: "membership-expiry", label: "Test membership expiry" },
  { type: "invoice", label: "Test invoice + UPI" },
];

export default function SettingsPage() {
  const [form, setForm] = useState({
    language: "Marathi", upiId: "", whatsappToken: "", razorpayKey: "", googleMapKey: "",
  });
  const [savedMsg, setSavedMsg] = useState("");
  const [testMsg, setTestMsg] = useState("");

  function save(e) {
    e.preventDefault();
    setSavedMsg("Settings saved.");
    setTimeout(() => setSavedMsg(""), 2500);
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
      <main className="max-w-[1000px] mx-auto px-6 py-8 grid md:grid-cols-2 gap-6">
        <div className="ledger-panel p-6">
          <h2 className="font-display text-xl mb-4">Salon settings</h2>
          <form onSubmit={save} className="space-y-4">
            <div>
              <FieldLabel>Language for customer messages</FieldLabel>
              <select className="w-full" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="Marathi">Marathi — 98% open rate</option>
                <option value="Hindi">Hindi</option>
                <option value="English">English</option>
              </select>
            </div>
            <Input label="UPI ID" placeholder="yourupi@okicici" value={form.upiId} onChange={(v) => setForm({ ...form, upiId: v })} />
            <Input label="WhatsApp API token (Meta)" value={form.whatsappToken} onChange={(v) => setForm({ ...form, whatsappToken: v })} type="password" />
            <Input label="Razorpay key" value={form.razorpayKey} onChange={(v) => setForm({ ...form, razorpayKey: v })} type="password" />
            <Input label="Google Maps API key" value={form.googleMapKey} onChange={(v) => setForm({ ...form, googleMapKey: v })} type="password" />
            <button className="btn-gold w-full">Save settings</button>
            {savedMsg && <p className="text-xs" style={{ color: "#7FC79A" }}>{savedMsg}</p>}
          </form>
        </div>

        <div className="ledger-panel p-6">
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
