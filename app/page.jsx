"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import api, { setSession } from "@/lib/api";

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
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", login);
      setSession({ token: data.token, companyId: data.companyId, subdomain: data.subdomain, name: data.name });
      router.push("/dashboard");
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not sign in. Check your subdomain, email and password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", reg);
      setSession({ token: data.token, companyId: data.companyId, subdomain: data.subdomain, name: reg.name });
      router.push("/dashboard");
    } catch (err) {
      setError(err?.response?.data?.msg || "Could not register. That subdomain may already be taken.");
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
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8">
            <p className="font-display text-2xl text-ledger-gold">Ledger</p>
          </div>

          <div className="flex gap-6 mb-8 border-b border-ledger-gold/15">
            {["login", "register"].map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(""); }}
                className="pb-3 text-sm capitalize"
                style={{
                  color: mode === m ? "#E0BD7C" : "#D9C7B8",
                  borderBottom: mode === m ? "2px solid #C9A15A" : "2px solid transparent",
                }}
              >
                {m === "login" ? "Sign in" : "Register salon"}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-sm mb-4 px-3 py-2" style={{ background: "rgba(193,85,74,0.15)", color: "#E08076" }}>
              {error}
            </p>
          )}

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <Field label="Subdomain">
                <input
                  placeholder="mysalon"
                  value={login.subdomain}
                  onChange={(e) => setLogin({ ...login, subdomain: e.target.value })}
                  required
                  className="w-full"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={login.email}
                  onChange={(e) => setLogin({ ...login, email: e.target.value })}
                  required
                  className="w-full"
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  value={login.password}
                  onChange={(e) => setLogin({ ...login, password: e.target.value })}
                  required
                  className="w-full"
                />
              </Field>
              <button disabled={loading} className="btn-gold w-full mt-2">
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <Field label="Salon name">
                <input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} required className="w-full" />
              </Field>
              <Field label="Subdomain">
                <input
                  placeholder="mysalon"
                  value={reg.subdomain}
                  onChange={(e) => setReg({ ...reg, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  required
                  className="w-full"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select value={reg.salonType} onChange={(e) => setReg({ ...reg, salonType: e.target.value })} className="w-full">
                    <option value="unisex">Unisex</option>
                    <option value="men">Men</option>
                    <option value="women">Women</option>
                    <option value="spa">Spa</option>
                  </select>
                </Field>
                <Field label="Location">
                  <input placeholder="Baner, Pune" value={reg.location} onChange={(e) => setReg({ ...reg, location: e.target.value })} className="w-full" />
                </Field>
              </div>
              <Field label="Owner email">
                <input type="email" value={reg.ownerEmail} onChange={(e) => setReg({ ...reg, ownerEmail: e.target.value })} required className="w-full" />
              </Field>
              <Field label="Password">
                <input type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} required className="w-full" />
              </Field>
              <button disabled={loading} className="btn-gold w-full mt-2">
                {loading ? "Creating…" : "Create salon account"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-ledger-creamDim mb-1.5">{label}</span>
      {children}
    </label>
  );
}
