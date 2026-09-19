"use client";

import { useEffect, useState } from "react";
import api, { getSession } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";

export default function InvoicesPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [invoices, setInvoices] = useState([]);
  const [date, setDate] = useState("");

  function load() {
    api.get("/invoices/list", { params: { companyId, date: date || undefined } })
      .then((r) => setInvoices(r.data || [])).catch(() => {});
  }
  useEffect(() => { load(); }, [date]);

  async function markPaid(invoiceId) {
    try {
      await api.post("/invoices/pay", { invoiceId });
      load();
    } catch {
      alert("Could not update payment status.");
    }
  }

  async function sendInvoiceWA(bookingId) {
    try {
      const { data } = await api.post("/whatsapp/send", { bookingId, type: "invoice", language: "Marathi" });
      alert(data.message || data.msg);
    } catch {
      alert("Could not send WhatsApp message.");
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl">Invoices</h1>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm" />
        </div>
        <div className="ledger-panel">
          {invoices.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ledger-creamDim">No invoices yet — complete a booking to generate one automatically (INV-YYYY-XXXXXX).</p>
          ) : (
            <table className="ledger-table w-full">
              <thead>
                <tr><th>Invoice</th><th>Customer</th><th>Items</th><th>Total</th><th>GST</th><th>Grand total</th><th>Commission</th><th>Payment</th><th></th></tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv._id}>
                    <td className="text-ledger-gold font-semibold">{inv.invoiceNo}</td>
                    <td>{inv.customerName}<div className="text-xs text-ledger-creamDim">{inv.phone}</div></td>
                    <td className="text-xs">{(inv.items?.length || 0)} service{(inv.items?.length || 0) !== 1 ? "s" : ""}{inv.products?.length ? ` · ${inv.products.length} product(s)` : ""}</td>
                    <td>₹{inv.total}</td>
                    <td>₹{inv.gstTotal}</td>
                    <td className="font-semibold">₹{inv.grandTotal}</td>
                    <td style={{ color: "#7FC79A" }}>₹{inv.staffCommission}</td>
                    <td><StatusBadge status={inv.paymentStatus} /></td>
                    <td>
                      <div className="flex gap-1">
                        {inv.paymentStatus !== "paid" && <button onClick={() => markPaid(inv._id)} className="btn-ghost text-xs !py-1">Mark paid</button>}
                        <button onClick={() => sendInvoiceWA(inv.bookingId)} className="btn-ghost text-xs !py-1">WA + UPI</button>
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
