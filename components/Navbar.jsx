"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSession, clearSession } from "@/lib/api";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/bookings", label: "Bookings" },
  { href: "/calendar", label: "Calendar" },
  { href: "/services", label: "Services" },
  { href: "/staff", label: "Staff" },
  { href: "/packages", label: "Packages" },
  { href: "/offers", label: "Offers" },
  { href: "/memberships", label: "Memberships" },
  { href: "/products", label: "Products" },
  { href: "/invoices", label: "Invoices" },
  { href: "/settings", label: "Settings" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSessionState] = useState({});

  useEffect(() => {
    setSessionState(getSession());
  }, []);

  function logout() {
    clearSession();
    router.push("/");
  }

  return (
    <header className="border-b border-ledger-gold/20 bg-ledger-base/95 backdrop-blur sticky top-0 z-40">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl text-ledger-gold">Ledger</span>
            <span className="text-xs text-ledger-creamDim">
              {session.companyName || session.subdomain || "Salon & Spa OS"}
            </span>
          </div>
          <button onClick={logout} className="btn-ghost text-xs">
            Sign out
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto pb-2 -mb-px">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="px-3 py-2 text-sm whitespace-nowrap transition-colors"
                style={{
                  color: active ? "#E0BD7C" : "#D9C7B8",
                  borderBottom: active ? "2px solid #C9A15A" : "2px solid transparent",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
