"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api, { setSession, apiErrorMessage } from "@/lib/api";
import Alert from "@/components/Alert";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [login, setLogin] = useState({ subdomain: "", email: "", password: "" });
  const [reg, setReg] = useState({
    name: "",
    subdomain: "",
    ownerEmail: "",
    password: "",
    salonType: "unisex",
    location: "",
  });

  async function handleLogin(e) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", login);
      setSession({ token: data.token, companyId: data.companyId, subdomain: data.subdomain, name: data.name });
      router.push("/dashboard");
    } catch (err) {
      // A wrong password is a normal 401 here. The global interceptor only
      // clears the session for requests that carried a token, so a mistyped
      // password no longer wipes a valid session / redirects away.
      setError(apiErrorMessage(err, "Could not sign in. Check your subdomain, email and password."));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", reg);
      setSession({ token: data.token, companyId: data.companyId, subdomain: data.subdomain, name: reg.name });
      router.push("/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not register. That subdomain may already be taken."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-[42%] p-14 border-r border-ledger-gold/15">
        <div>
          <p className="font-display text-3xl text-ledger-gold">Ledger</p>
          <p className="text-xs text-ledger-creamDim tracking-wide mt-1">Salon &amp; Spa Operating System</p>
        </div>
        <div>
          <p className="font-display text-[2.6rem] leading-[1.15] text-ledger-cream max-w-md">
            Every appointment, every rupee, one open book.
          </p>
          <div className="gold-line w-24 my-6" />
          <ul className="space-y-2.5 text-sm text-ledger-creamDim">
            <li>Flat pricing in INR — no per-seat billing</li>
            <li>WhatsApp confirmations in Marathi, Hindi or English</li>
            <li>20% UPI advance, slot conflicts blocked automatically</li>
            <li>Staff commission and no-show charges tracked without spreadsheets</li>
          </ul>
        </div>
        <p className="text-xs text-ledger-creamDim/70">Setup ₹9,999 · ₹499/mo flat, unlimited staff</p>
      </div>

      {/* Right: form */}
      {/* This is the page's main content, so it carries the <main> landmark and
          the <h1> that every other route already has. Without them this was the
          one page a screen-reader user could not skip to or identify. */}
      <main className="flex-1 flex items-center justify-center p-8 max-tiny:p-2">
        <div className="w-full max-w-sm min-w-0">
          <h1 className="sr-only">Salon &amp; Spa OS — sign in or register your salon</h1>
          <div className="lg:hidden mb-8">
            <p className="font-display text-2xl max-tiny:text-lg text-ledger-gold">Ledger</p>
          </div>

          <div className="flex gap-6 max-tiny:gap-2 mb-8 border-b border-ledger-gold/15" role="tablist" aria-label="Sign in or register">
            {["login", "register"].map((m) => (
              <button
                key={m}
                id={`auth-tab-${m}`}
                role="tab"
                type="button"
                aria-selected={mode === m}
                aria-controls="auth-panel"
                onClick={() => { setMode(m); setError(""); }}
                className="pb-3 px-1.5 min-w-[44px] min-h-[44px] inline-flex items-center text-sm max-tiny:text-xs capitalize"
                style={{
                  color: mode === m ? "#E0BD7C" : "#D9C7B8",
                  borderBottom: mode === m ? "2px solid #C9A15A" : "2px solid transparent",
                }}
              >
                {m === "login" ? "Sign in" : "Register salon"}
              </button>
            ))}
          </div>

          <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`}>
            {error && <Alert className="mb-4">{error}</Alert>}

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <Field label="Subdomain">
                  <input
                    name="subdomain"
                    autoComplete="organization"
                    placeholder="mysalon"
                    value={login.subdomain}
                    onChange={(e) => setLogin({ ...login, subdomain: e.target.value })}
                    required
                    className="w-full"
                  />
                </Field>
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={login.email}
                    onChange={(e) => setLogin({ ...login, email: e.target.value })}
                    required
                    className="w-full"
                  />
                </Field>
                <Field label="Password">
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={login.password}
                    onChange={(e) => setLogin({ ...login, password: e.target.value })}
                    required
                    className="w-full"
                  />
                </Field>
                <button type="submit" disabled={loading} className="btn-gold w-full mt-2">
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <Field label="Salon name">
                  <input name="name" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} required className="w-full" />
                </Field>
                <Field label="Subdomain">
                  <input
                    name="subdomain"
                    autoComplete="organization"
                    placeholder="mysalon"
                    value={reg.subdomain}
                    onChange={(e) => setReg({ ...reg, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    required
                    className="w-full"
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Type">
                    <select name="salonType" value={reg.salonType} onChange={(e) => setReg({ ...reg, salonType: e.target.value })} className="w-full">
                      <option value="unisex">Unisex</option>
                      <option value="men">Men</option>
                      <option value="women">Women</option>
                      <option value="spa">Spa</option>
                    </select>
                  </Field>
                  <Field label="Location">
                    <input name="location" placeholder="Baner, Pune" value={reg.location} onChange={(e) => setReg({ ...reg, location: e.target.value })} className="w-full" />
                  </Field>
                </div>
                <Field label="Owner email">
                  <input name="ownerEmail" type="email" autoComplete="email" value={reg.ownerEmail} onChange={(e) => setReg({ ...reg, ownerEmail: e.target.value })} required className="w-full" />
                </Field>
                <Field label="Password">
                  <input
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    aria-describedby="password-hint"
                    value={reg.password}
                    onChange={(e) => setReg({ ...reg, password: e.target.value })}
                    required
                    className="w-full"
                  />
                </Field>
                <p id="password-hint" className="text-xs text-ledger-creamDim">At least 8 characters.</p>
                <button type="submit" disabled={loading} className="btn-gold w-full mt-2">
                  {loading ? "Creating…" : "Create salon account"}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
