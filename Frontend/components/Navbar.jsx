"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);

  useEffect(() => {
    setSessionState(getSession());
  }, []);

  // Close the mobile menu whenever the route changes (Next.js navigation).
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on Escape and return focus to the hamburger button.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  function logout() {
    clearSession();
    router.push("/");
  }

  return (
    <header className="border-b border-ledger-gold/20 bg-ledger-base/95 backdrop-blur sticky top-0 z-40">
      <div className="page max-w-[1400px] mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-16 py-2 sm:py-0">
          <div className="flex items-baseline gap-2 min-w-0 max-tiny:flex-col max-tiny:items-stretch max-tiny:gap-0">
            <span className="font-display text-2xl max-tiny:text-lg text-ledger-gold shrink-0">Ledger</span>
            {/* Truncates on desktop as before, but below 220px the wordmark
                already fills the row, so the company name drops to its own line
                and wraps instead of being squeezed to zero width. */}
            <span className="text-xs text-ledger-creamDim truncate min-w-0 max-tiny:whitespace-normal max-tiny:overflow-visible max-tiny:text-ellipsis-clip">
              {session.companyName || session.subdomain || "Salon & Spa OS"}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={logout}
              className="btn-ghost text-xs hidden lg:inline-flex shrink-0 whitespace-nowrap"
            >
              Sign out
            </button>
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-menu"
              className="btn-ghost py-2 px-2.5 lg:hidden shrink-0 min-w-[44px] min-h-[44px] inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ledger-gold/70"
            >
              <span className="block relative w-5 h-4" aria-hidden="true">
                <span
                  className={`block absolute left-0 w-full h-0.5 rounded bg-current transition-transform duration-200 ${
                    menuOpen ? "top-1.5 rotate-45" : "top-0"
                  }`}
                />
                <span
                  className={`block absolute left-0 top-1.5 w-full h-0.5 rounded bg-current transition-opacity duration-200 ${
                    menuOpen ? "opacity-0" : ""
                  }`}
                />
                <span
                  className={`block absolute left-0 w-full h-0.5 rounded bg-current transition-transform duration-200 ${
                    menuOpen ? "top-1.5 -rotate-45" : "top-3"
                  }`}
                />
              </span>
            </button>
          </div>
        </div>
        <nav
          className="hidden lg:flex gap-1 overflow-x-auto pb-2 -mb-px no-scrollbar"
          aria-label="Main navigation"
        >
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className="px-3 py-2 text-sm whitespace-nowrap transition-colors shrink-0"
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
        {menuOpen && (
          <nav
            id="mobile-nav-menu"
            aria-label="Mobile navigation"
            className="lg:hidden flex flex-col py-2 pb-3"
          >
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  // The hamburger exists only on touch-sized viewports, so this
                  // row is always finger-operated: keep the full 44px target
                  // rather than the 36px that px-3/py-2 on a 14px line yields.
                  className="px-3 py-2 min-h-[44px] inline-flex items-center text-sm max-tiny:px-1.5 max-tiny:text-xs whitespace-nowrap transition-colors"
                  style={{
                    color: active ? "#E0BD7C" : "#D9C7B8",
                    borderLeft: active ? "2px solid #C9A15A" : "2px solid transparent",
                  }}
                >
                  {link.label}
                </Link>
              );
            })}
            <button
              onClick={logout}
              className="btn-ghost text-xs self-start mt-2 shrink-0 whitespace-nowrap"
            >
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}
