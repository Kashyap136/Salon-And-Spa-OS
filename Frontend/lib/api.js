import axios from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5005/api";

const api = axios.create({
  baseURL: BASE_URL,
  // Without a timeout a hung backend leaves every page spinning forever with no
  // error the user can act on.
  timeout: 20000,
});

/** Endpoints where a 401 is a normal outcome, not an expired session. */
const AUTH_ENDPOINTS = ["/auth/login", "/auth/register"];

/** Endpoints reachable without a session (public booking page). */
const PUBLIC_PATHS = [
  "/services/public",
  "/packages/public",
  "/staff/public",
  "/offers/public",
  // authOptional server-side: the public page previews a coupon before the
  // guest has any session, so this must never be treated as needing one.
  "/offers/validate",
  "/reviews/",
  "/bookings/public/",
  "/leads/create",
];

function isPublicRequest(url = "") {
  return PUBLIC_PATHS.some((p) => url.includes(p));
}

// Attach JWT bearer token to every request automatically.
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    // Public catalog/booking endpoints are called by guests who may still have
    // a stale token in localStorage. Sending it makes the backend reject the
    // request with 401 ("present but invalid token") and log the guest out of a
    // perfectly valid public page.
    if (token && !isPublicRequest(config.url)) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// On a 401 from a request that needs a session, clear the session and bounce to
// login. This covers BOTH "we sent a token and the server rejected it" (expired
// or revoked) and "we had no token to send at all" - a visitor who bookmarks
// /invoices, or whose localStorage was cleared, otherwise lands on a dead page
// that silently fails to load and has to be redirected by hand.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";

    const needsSession =
      status === 401 &&
      !isPublicRequest(url) &&
      !AUTH_ENDPOINTS.some((p) => url.includes(p));

    if (typeof window !== "undefined" && needsSession) {
      clearSession();
      // Avoid a redirect loop if we are already on the login page, and never
      // bounce a guest off a public booking page.
      if (!window.location.pathname.startsWith("/public/") && window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }
    return Promise.reject(err);
  }
);

export function getSession() {
  if (typeof window === "undefined") return {};
  return {
    token: localStorage.getItem("token"),
    companyId: localStorage.getItem("companyId"),
    subdomain: localStorage.getItem("subdomain"),
    companyName: localStorage.getItem("companyName"),
  };
}

export function setSession({ token, companyId, subdomain, name }) {
  if (token) localStorage.setItem("token", token);
  if (companyId) localStorage.setItem("companyId", companyId);
  if (subdomain) localStorage.setItem("subdomain", subdomain);
  if (name) localStorage.setItem("companyName", name);
  else localStorage.removeItem("companyName");
}

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("companyId");
  localStorage.removeItem("subdomain");
  localStorage.removeItem("companyName");
}

export function fileUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  const origin = BASE_URL.replace(/\/api\/?$/, "");
  return `${origin}${path}`;
}

/**
 * Human-readable message for any thrown axios error. Every page uses this so a
 * network failure is never rendered as a blank screen.
 */
export function apiErrorMessage(err, fallback = "Something went wrong. Please try again.") {
  if (!err) return fallback;
  if (err.code === "ECONNABORTED" || /timeout/i.test(err.message || "")) {
    return "The server took too long to respond. Please try again.";
  }
  if (err.response) {
    const data = err.response.data;
    if (typeof data === "string" && data) return data;
    if (data && typeof data.msg === "string" && data.msg) return data.msg;
    if (data && typeof data.error === "string" && data.error) return data.error;
    if (err.response.status === 500) return "The server hit an unexpected error. Please try again.";
    return `Request failed (${err.response.status}).`;
  }
  if (err.request) return "Could not reach the server. Check your connection and try again.";
  return err.message || fallback;
}

/**
 * Download a file that lives behind the authenticated API (invoice PDF, audit
 * workbook). These are NOT static URLs, so a plain <a href> or window.open()
 * would arrive without the bearer token and receive a 401. Fetching as a blob
 * lets us attach the header and still hand the file to the browser.
 */
export async function downloadFile(path, filename) {
  if (!path) throw new Error("No file to download");
  const token = getSession().token;
  const res = await api.get(fileUrl(path), {
    responseType: "blob",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  const disposition = res.headers?.["content-disposition"] || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = filename || (match ? decodeURIComponent(match[1]) : "download");

  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default api;
