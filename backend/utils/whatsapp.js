const axios = require("axios");

/**
 * WhatsApp message builders + sender.
 *
 * Real Meta Cloud API integration is used when WHATSAPP_TOKEN and
 * WHATSAPP_PHONE_ID are configured. Without credentials the sender logs the
 * message and returns a mocked result so the app stays fully usable.
 */

function mapLink(company) {
  if (company && company.location) {
    return `https://maps.google.com/?q=${encodeURIComponent(company.location)}`;
  }
  return "https://maps.google.com/?q=18.5204,73.8567";
}

function upiIdFor(company) {
  return (company && company.upiId) || process.env.UPI_ID || "salon@upi";
}

const LANGUAGES = ["Marathi", "Hindi", "English"];

function normLang(language) {
  const l = (language || "").toString().trim();
  return LANGUAGES.includes(l) ? l : "Marathi";
}

const T = {
  Marathi: {
    confirmation: (d) =>
      `नमस्कार ${d.customerName}! 🌸\n` +
      `${d.salonName} मध्ये तुमची बुकिंग कन्फर्म झाली आहे.\n` +
      `📅 तारीख: ${d.bookingDate}\n⏰ वेळ: ${d.slot}\n` +
      `💇 सेवा: ${d.serviceName}\n👩‍🎨 स्टायलिस्ट: ${d.staffName}\n` +
      `💰 आगाऊ (Advance): ₹${d.advance}\n` +
      `💳 UPI: ${d.upiId}\n` +
      `📍 Location: ${d.map}`,
    noshow: (d) =>
      `नमस्कार ${d.customerName}, आपण ${d.bookingDate} रोजी ${d.slot} च्या भेटीसाठी न आल्याने ती No-show म्हणून चिन्हांकित केली आहे.\n` +
      `आगाऊ रक्कम ₹${d.advance} जमा राहते. पुन्हा बुकिंग करण्यासाठी संपर्क करा.`,
    upsell: (d) =>
      `नमस्कार ${d.customerName}! तुमच्या भेटीमध्ये आणखी Spa सेवा फक्त ₹300 मध्ये जोडायची आहे का? होय उत्तर द्या — YES.\n${d.salonName}`,
    membership_expiry: (d) =>
      `नमस्कार ${d.customerName}! आपली ${d.packageName} सदस्यत्व ${d.endDate} रोजी संपत आहे.\n` +
      `नूतनीकरणासाठी UPI वर भरणा करा: ${d.upiId}\n${d.salonName}`,
    invoice: (d) =>
      `नमस्कार ${d.customerName}! तुमची पावती तयार आहे.\n` +
      `🧾 Invoice: ${d.invoiceNo}\n💰 एकूण रक्कम: ₹${d.grandTotal}\n` +
      `💳 UPI: ${d.upiId}\n` +
      `Download PDF: ${d.pdfUrl}\n${d.salonName}`,
  },
  Hindi: {
    confirmation: (d) =>
      `नमस्कार ${d.customerName}! 🌸\n` +
      `${d.salonName} में आपकी बुकिंग कन्फर्म हो गई है।\n` +
      `📅 तारीख: ${d.bookingDate}\n⏰ समय: ${d.slot}\n` +
      `💇 सेवा: ${d.serviceName}\n👩‍🎨 स्टाइलिस्ट: ${d.staffName}\n` +
      `💰 एडवांस: ₹${d.advance}\n` +
      `💳 UPI: ${d.upiId}\n` +
      `📍 Location: ${d.map}`,
    noshow: (d) =>
      `नमस्कार ${d.customerName}, ${d.bookingDate} को ${d.slot} की भेट के लिए न आने पर इसे No-show चिह्नित किया गया।\n` +
      `एडवांस राशि ₹${d.advance} सुरक्षित रहती है। पुनः बुकिंग के लिए संपर्क करें।`,
    upsell: (d) =>
      `नमस्कार ${d.customerName}! आपकी भेट में Spa सेवा केवल ₹300 में और जोड़ें? हाँ के लिए YES लिखें।\n${d.salonName}`,
    membership_expiry: (d) =>
      `नमस्कार ${d.customerName}! आपकी ${d.packageName} सदस्यता ${d.endDate} को समाप्त हो रही है।\n` +
      `नवीनीकरण के लिए UPI से भुगतान करें: ${d.upiId}\n${d.salonName}`,
    invoice: (d) =>
      `नमस्कार ${d.customerName}! आपका इनवॉइस तैयार है।\n` +
      `🧾 Invoice: ${d.invoiceNo}\n💰 कुल राशि: ₹${d.grandTotal}\n` +
      `💳 UPI: ${d.upiId}\n` +
      `Download PDF: ${d.pdfUrl}\n${d.salonName}`,
  },
  English: {
    confirmation: (d) =>
      `Hello ${d.customerName}! 🌸\n` +
      `Your booking at ${d.salonName} is confirmed.\n` +
      `📅 Date: ${d.bookingDate}\n⏰ Slot: ${d.slot}\n` +
      `💇 Service: ${d.serviceName}\n👩‍🎨 Stylist: ${d.staffName}\n` +
      `💰 Advance: ₹${d.advance}\n` +
      `💳 UPI: ${d.upiId}\n` +
      `📍 Location: ${d.map}`,
    noshow: (d) =>
      `Hello ${d.customerName}, your appointment on ${d.bookingDate} at ${d.slot} was marked as No-show.\n` +
      `Advance of ₹${d.advance} is retained. Please contact us to rebook.`,
    upsell: (d) =>
      `Hello ${d.customerName}! Add a Spa service to your visit for just ₹300 more? Reply YES.\n${d.salonName}`,
    membership_expiry: (d) =>
      `Hello ${d.customerName}! Your ${d.packageName} membership expires on ${d.endDate}.\n` +
      `Renew by paying via UPI: ${d.upiId}\n${d.salonName}`,
    invoice: (d) =>
      `Hello ${d.customerName}! Your invoice is ready.\n` +
      `🧾 Invoice: ${d.invoiceNo}\n💰 Grand Total: ₹${d.grandTotal}\n` +
      `💳 UPI: ${d.upiId}\n` +
      `Download PDF: ${d.pdfUrl}\n${d.salonName}`,
  },
};

/** Build the raw message text for a WhatsApp message type. */
function buildMessage(type, data, language) {
  const lang = normLang(language);
  const key = {
    "confirmation": "confirmation",
    "no-show": "noshow",
    "upsell": "upsell",
    "membership-expiry": "membership_expiry",
    "invoice": "invoice",
  }[type];
  const fn = key && T[lang] && T[lang][key];
  if (!fn) return null;
  return fn(data);
}

/**
 * Send a WhatsApp message via the Meta Cloud API.
 * Returns { mocked: true, text } when credentials are missing.
 */
async function sendWhatsAppMessage({ to, text }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId || !to) {
    console.log(`[whatsapp:mock] to=${to}:\n${text}`);
    return { mocked: true, text };
  }

  const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: String(to).replace(/\D/g, ""),
    type: "text",
    text: { body: text },
  };
  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  return { mocked: false, text, result: res.data };
}

module.exports = { buildMessage, sendWhatsAppMessage, mapLink, upiIdFor };