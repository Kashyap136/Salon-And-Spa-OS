"use client";

import { useEffect, useState } from "react";
import api, { apiErrorMessage } from "@/lib/api";
import Navbar from "@/components/Navbar";
import Alert from "@/components/Alert";
import { FieldLabel, Input } from "@/components/Field";

// `label` is the primary line, `hint` an optional qualifier rendered on its own
// line. Splitting them keeps each line short enough to break at a word
// boundary in a narrow column instead of mid-phrase.
const TESTS = [
  { type: "confirmation", label: "Test confirmation", hint: "WA, Marathi" },
  { type: "no-show", label: "Test no-show reminder", hint: null },
  { type: "upsell", label: "Test upsell", hint: "Spa ₹300" },
  { type: "membership-expiry", label: "Test membership expiry", hint: null },
  { type: "invoice", label: "Test invoice", hint: "+ UPI link" },
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
  const [testError, setTestError] = useState("");
  const [testBusy, setTestBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/auth/settings")
      .then(({ data }) => {
        if (cancelled) return;
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
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, "Could not load settings — are you signed in?"));
      })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  async function save(e) {
    e.preventDefault();
    if (saving || !loaded) return;
    setError("");
    setSavedMsg("");
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
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save settings."));
    } finally {
      setSaving(false);
    }
  }

  async function runTest(type) {
    if (testBusy) return;
    setTestMsg("");
    setTestError("");
    setTestBusy(type);
    try {
      const { data } = await api.post("/whatsapp/test", { language: form.language, type });
      setTestMsg(data.msg);
    } catch (err) {
      setTestError(apiErrorMessage(err, "Could not reach the WhatsApp test endpoint."));
    } finally {
      setTestBusy(null);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1000px] mx-auto py-8 grid md:grid-cols-2 gap-6">
      {/* Page-level heading for assistive tech; the visible card headings are
          h2s underneath it. */}
      <h1 className="sr-only">Salon settings</h1>
        <div className="ledger-panel panel-pad-lg min-w-0">
          <h2 className="panel-title mb-4">Salon settings</h2>
          {error && <Alert className="mb-3">{error}</Alert>}
          <form onSubmit={save} className="space-y-4">
            <div>
              <FieldLabel>Message language</FieldLabel>
              <select
                className="w-full"
                aria-label="Message language"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
              >
                <option value="Marathi">Marathi — 98% open rate</option>
                <option value="Hindi">Hindi</option>
                <option value="English">English</option>
              </select>
            </div>
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <div>
                <FieldLabel>Salon type</FieldLabel>
                <select
                  className="w-full"
                  aria-label="Salon type"
                  value={form.salonType}
                  onChange={(e) => setForm({ ...form, salonType: e.target.value })}
                >
                  {SALON_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </div>
              <Input label="Location" placeholder="Baner, Pune" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
            </div>
            <Input label="UPI ID" placeholder="yourupi@okicici" value={form.upiId} onChange={(v) => setForm({ ...form, upiId: v })} />
            <div className="grid grid-cols-1 narrow:grid-cols-2 gap-3">
              <Input label="GST number" placeholder="27AABCU9603R1ZM" value={form.gstNo} onChange={(v) => setForm({ ...form, gstNo: v })} />
              <Input label="Razorpay key" placeholder="rzp_live_..." value={form.razorpayKey} onChange={(v) => setForm({ ...form, razorpayKey: v })} />
            </div>
            <label className="check-row text-sm text-ledger-creamDim">
              <input
                type="checkbox"
                aria-label="Send WhatsApp messages for bookings"
                checked={form.whatsappEnabled}
                onChange={(e) => setForm({ ...form, whatsappEnabled: e.target.checked })}
              />
              {/* Visible caption kept short so it stays on one line in a narrow
                  column; the accessible name still carries the full sentence. */}
              <span>WhatsApp messages</span>
            </label>
            <button type="submit" disabled={saving || !loaded} className="btn-gold w-full">
              {saving ? "Saving…" : loaded ? "Save settings" : "Loading…"}
            </button>
            {/* role=status (not alert): a successful save is information, and a
                live region that also fires alerts is announced twice by most
                screen readers. */}
            {savedMsg && <p className="text-xs break-words" role="status" style={{ color: "#7FC79A" }}>{savedMsg}</p>}
          </form>

          <div className="gold-line my-6" />
          <p className="text-xs text-ledger-creamDim leading-relaxed break-words">
            The WhatsApp API token and phone ID are read from the server&apos;s environment
            ({whatsappConfigured ? "configured ✓" : "not configured — messages fall back to preview mode"}).
            Keys are never stored in or returned by the app.
          </p>
        </div>

        <div className="ledger-panel panel-pad-lg min-w-0">
          <h2 className="panel-title mb-4">WhatsApp tests</h2>
          <div className="space-y-2">
            {TESTS.map((t) => {
              const busy = testBusy === t.type;
              return (
                <button
                  key={t.type}
                  type="button"
                  onClick={() => runTest(t.type)}
                  disabled={testBusy !== null}
                  className="btn-ghost stack-btn w-full"
                >
                  <span className="block min-w-0">
                    <span className="block">{busy ? "Sending…" : t.label}</span>
                    {!busy && t.hint && (
                      /* Own line only while the column is too narrow to hold
                         label+qualifier together; inline from 380px up so
                         desktop keeps the single-line button. */
                      <span className="block text-[0.7rem] font-normal text-ledger-creamDim narrow:inline narrow:ml-1.5">
                        {t.hint}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {testMsg && <p className="text-xs mt-4 break-words" role="status" aria-live="polite" style={{ color: "#E0BD7C" }}>{testMsg}</p>}
          {testError && <Alert className="mt-4">{testError}</Alert>}

          <div className="gold-line my-6" />
          <p className="text-xs text-ledger-creamDim leading-relaxed break-words">
            Setup ₹9,999 + ₹499/mo flat, unlimited staff — vs Calendly at ~₹11,600/mo per seat.
            WhatsApp-first Marathi/Hindi messaging, UPI advance with no-show charge kept, staff
            commission calculated automatically, low-stock and membership-expiry alerts included.
          </p>
        </div>
      </main>
    </div>
  );
}