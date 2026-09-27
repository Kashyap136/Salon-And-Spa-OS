"use client";

import { useCallback, useEffect, useState } from "react";
import api, { getSession, apiErrorMessage, downloadFile } from "@/lib/api";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import Alert from "@/components/Alert";
import { CardList, CardItem, Row } from "@/components/DataCard";

export default function InvoicesPage() {
  const { companyId } = typeof window !== "undefined" ? getSession() : {};
  const [invoices, setInvoices] = useState([]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/invoices/list", { params: { companyId, date: date || undefined } })
      .then((r) => { setInvoices(Array.isArray(r.data) ? r.data : []); setLoadError(""); })
      .catch((err) => { setInvoices([]); setLoadError(apiErrorMessage(err, "Could not load invoices.")); })
      .finally(() => setLoading(false));
  }, [companyId, date]);
  useEffect(() => { load(); }, [load]);

  async function run(key, fn, success) {
    if (busy) return;
    setError("");
    setNotice("");
    setBusy(key);
    try {
      await fn();
      if (success) setNotice(success);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const markPaid = (id, no) => run(
    `${id}:pay`,
    async () => { await api.post("/invoices/pay", { invoiceId: id }); load(); },
    `${no} marked paid.`
  );

  const sendInvoiceWA = (bookingId) => run(
    `${bookingId}:wa`,
    async () => {
      const { data } = await api.post("/whatsapp/send", { bookingId, type: "invoice", language: "Marathi" });
      setNotice(data.message || data.msg || "WhatsApp invoice sent.");
    }
  );

  // The PDF lives behind auth, so a plain <a href> would 401. Fetch as a blob
  // with the bearer token and hand the browser a download.
  // The route is keyed by INVOICE id (not booking id) and re-checks the tenant.
  const downloadPdf = (inv) => run(
    `${inv._id}:pdf`,
    () => downloadFile(`/invoices/pdf/${inv._id}`, `${inv.invoiceNo}.pdf`),
    `${inv.invoiceNo} downloaded.`
  );

  // Shared by the table's action cell and the narrow-width card list.
  function invoiceItems(inv) {
    return (
      <>
        {(inv.items?.length || 0)} service{(inv.items?.length || 0) !== 1 ? "s" : ""}
        {inv.products?.length ? ` · ${inv.products.length} product(s)` : ""}
      </>
    );
  }

  function invoiceActions(inv) {
    return (
      <>
        {inv.paymentStatus !== "paid" && (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => markPaid(inv._id, inv.invoiceNo)}
            className="btn-ghost text-xs !py-1 min-w-[44px]"
          >
            {busy === `${inv._id}:pay` ? "…" : "Mark paid"}
          </button>
        )}
        <button
          type="button"
          disabled={Boolean(busy) || !inv.bookingId}
          onClick={() => sendInvoiceWA(inv.bookingId)}
          className="btn-ghost text-xs !py-1 min-w-[44px]"
          aria-label={`Send ${inv.invoiceNo} on WhatsApp with UPI link`}
        >
          {busy === `${inv.bookingId}:wa` ? "…" : "WA + UPI"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !inv.bookingId}
          onClick={() => downloadPdf(inv)}
          className="btn-ghost text-xs !py-1 min-w-[44px]"
          aria-label={`Download PDF for ${inv.invoiceNo}`}
        >
          {busy === `${inv._id}:pdf` ? "…" : "PDF"}
        </button>
      </>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="page max-w-[1400px] mx-auto py-8 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="page-title">Invoices</h1>
          <label className="inline-field text-xs">
            <span className="text-ledger-creamDim shrink-0">Created on</span>
            <input
              type="date"
              aria-label="Filter invoices by creation date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm min-w-0 max-w-full"
            />
          </label>
        </div>

        {error && <Alert className="mb-3">{error}</Alert>}
        {notice && <Alert tone="success" className="mb-3">{notice}</Alert>}

        <div className="ledger-panel min-w-0">
          {loading ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim" role="status">Loading invoices…</p>
          ) : loadError ? (
            <div className="panel-body py-10">
              <Alert>{loadError}</Alert>
              <button type="button" onClick={load} className="btn-ghost text-xs mt-3">Retry</button>
            </div>
          ) : invoices.length === 0 ? (
            <p className="panel-body py-10 text-sm text-ledger-creamDim">No invoices yet — complete a booking to generate one automatically (INV-YYYY-XXXXXX).</p>
          ) : (
            <div className="overflow-x-auto max-sm:hidden">
              <table className="ledger-table w-full min-w-[880px]">
                <thead>
                  <tr><th>Invoice</th><th>Customer</th><th>Items</th><th>Total</th><th>GST</th><th>Grand total</th><th>Commission</th><th>Payment</th><th></th></tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv._id}>
                      <td className="text-ledger-gold font-semibold">{inv.invoiceNo}</td>
                      <td className="break-words">{inv.customerName}<div className="text-xs text-ledger-creamDim">{inv.phone}</div></td>
                      <td className="text-xs">{invoiceItems(inv)}</td>
                      <td>₹{inv.total}</td>
                      <td>₹{inv.gstTotal}</td>
                      <td className="font-semibold">₹{inv.grandTotal}</td>
                      <td style={{ color: "#7FC79A" }}>₹{inv.staffCommission}</td>
                      <td><StatusBadge status={inv.paymentStatus} /></td>
                      <td>
                        <div className="flex flex-wrap gap-1">{invoiceActions(inv)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* The 880px table needs 8x horizontal scrolling at 132px. Below
              640px the same invoices render as cards instead. */}
          {!loading && !loadError && invoices.length > 0 && (
            <CardList>
              {invoices.map((inv) => (
                <CardItem key={inv._id}>
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2 min-w-0">
                    <p className="text-ledger-gold font-semibold min-w-0 break-words">{inv.invoiceNo}</p>
                    <StatusBadge status={inv.paymentStatus} />
                  </div>
                  <dl className="space-y-1">
                    <Row label="Customer">
                      {inv.customerName}
                      <span className="block text-xs text-ledger-creamDim">{inv.phone}</span>
                    </Row>
                    <Row label="Items">{invoiceItems(inv)}</Row>
                    <Row label="Total">₹{inv.total}</Row>
                    <Row label="GST">₹{inv.gstTotal}</Row>
                    <Row label="Grand total">₹{inv.grandTotal}</Row>
                    <Row label="Commission">
                      <span style={{ color: "#7FC79A" }}>₹{inv.staffCommission}</span>
                    </Row>
                  </dl>
                  <div className="flex flex-wrap gap-1 mt-3">{invoiceActions(inv)}</div>
                </CardItem>
              ))}
            </CardList>
          )}
        </div>
      </main>
    </div>
  );
}
