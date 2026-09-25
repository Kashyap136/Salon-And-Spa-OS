const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { AppError } = require("./helpers");

const INVOICE_DIR = path.join(__dirname, "..", "public", "exports", "invoices");

/**
 * Generate an invoice PDF with PDFKit, embedding a UPI-payment QR code.
 * Returns { filePath, url } — url is served from /public/exports/invoices/.
 */
async function generateInvoicePdf({ company, invoice }) {
  fs.mkdirSync(INVOICE_DIR, { recursive: true });

  const safeNo = invoice.invoiceNo.replace(/[^\w-]/g, "_");
  const fileName = `invoice-${safeNo}.pdf`;
  const filePath = path.join(INVOICE_DIR, fileName);

  const upiId = (company && company.upiId) || process.env.UPI_ID || "salon@upi";
  const qrUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&am=${invoice.grandTotal}&cu=INR`;
  let qrImage = null;
  try {
    qrImage = await QRCode.toDataURL(qrUrl);
  } catch {
    qrImage = null; // QR is optional — PDF must not fail without it.
  }

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#2A0F1C").text(company.name || "Salon & Spa", { align: "center" });
  doc.font("Helvetica").fontSize(10).fillColor("#555");
  doc.text(company.location || "", { align: "center" });
  doc.text(`GSTIN: ${company.gstNo || "—"}`, { align: "center" });
  doc.moveDown(1.5);

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text("INVOICE");
  doc.font("Helvetica").fontSize(10).fillColor("#333");
  doc.text(`Invoice No: ${invoice.invoiceNo}`);
  doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString("en-IN")}`);
  doc.text(`Customer: ${invoice.customerName}`);
  if (invoice.phone) doc.text(`Phone: ${invoice.phone}`);
  doc.moveDown(1);

  // Items table header
  const startY = doc.y;
  doc.font("Helvetica-Bold").fillColor("#000");
  doc.text("Item", 48, startY, { width: 300 });
  doc.text("Qty", 348, startY, { width: 60 });
  doc.text("Amount", 420, startY, { width: 120, align: "right" });
  doc.moveDown(0.4);
  doc.strokeColor("#C9A15A").moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.6);

  doc.font("Helvetica").fillColor("#333");
  for (const item of invoice.items || []) {
    const label = item.service && item.service.name ? item.service.name : "Service";
    doc.text(label, 48, doc.y, { width: 300 });
    doc.text("1", 348, doc.y, { width: 60 });
    doc.text(`₹${item.price || 0}`, 420, doc.y, { width: 120, align: "right" });
    doc.moveDown(0.35);
  }
  for (const p of invoice.products || []) {
    doc.text("Product", 48, doc.y, { width: 300 });
    doc.text(String(p.qty || 1), 348, doc.y, { width: 60 });
    doc.text(`₹${p.price || 0}`, 420, doc.y, { width: 120, align: "right" });
    doc.moveDown(0.35);
  }

  doc.moveDown(1);
  const x = 420;
  const row = (label, val, bold) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(bold ? "#000" : "#333");
    doc.text(label, x, doc.y, { width: 180 });
    doc.text(`₹${val}`, x + 130, doc.y - doc.currentLineHeight(), { width: 120, align: "right" });
    doc.moveDown(0.35);
  };
  row("Total", invoice.total || 0, false);
  row("GST (18%)", invoice.gstTotal || 0, false);
  if (invoice.discount) row("Discount", `-${invoice.discount}`, false);
  row("Grand Total", invoice.grandTotal || 0, true);
  doc.moveDown(1);

  if (qrImage) {
    const size = 110;
    doc.image(qrImage, 48, doc.y, { width: size, height: size });
    doc.font("Helvetica").fontSize(9).fillColor("#555");
    doc.text(`Scan to pay ${invoice.grandTotal} via UPI`, 170, doc.y);
    doc.text(upiId, 170, doc.y + 14);
  }

  doc.moveDown(2);
  doc.font("Helvetica").fontSize(9).fillColor("#777");
  doc.text("Thank you for visiting!", 48, 720, { align: "center" });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { filePath, url: `/public/exports/invoices/${fileName}` };
}

module.exports = { generateInvoicePdf, INVOICE_DIR };