import axios from "axios";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5005/api";

const api = axios.create({ baseURL: BASE_URL });

// Attach JWT bearer token to every request automatically
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 (expired/invalid token), clear session and bounce to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window !== "undefined" && err?.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("companyId");
      localStorage.removeItem("subdomain");
      window.location.href = "/";
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
  localStorage.setItem("token", token);
  localStorage.setItem("companyId", companyId);
  localStorage.setItem("subdomain", subdomain);
  if (name) localStorage.setItem("companyName", name);
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

export default api;
