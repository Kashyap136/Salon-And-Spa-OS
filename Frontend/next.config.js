/** @type {import('next').NextConfig} */
const path = require("path");
const { loadEnvConfig } = require("@next/env");

// next.config.js is evaluated BEFORE Next populates process.env from the .env
// files, so read them explicitly here. Without this, a perfectly correct
// deployment looks like it has no NEXT_PUBLIC_API_URL and the check below would
// fail the build for the wrong reason.
loadEnvConfig(path.join(__dirname), process.env.NODE_ENV !== "production");

// NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so a
// missing or wrong value cannot be detected at runtime - the app simply loads
// and every request goes nowhere. Fail the build instead, but only for a
// production build: `npm run dev` is expected to work with the development
// default in lib/api.js.
//
// A localhost value is refused too, because a client bundle resolves that
// hostname on the *customer's* machine, never the server's. Set
// NEXT_PUBLIC_API_URL_ALLOW_LOCAL=1 to build deliberately for a machine-local
// install (single-user desktop, an on-device demo) - never in a deployment.
const isProdBuild = process.env.NODE_ENV === "production";
if (isProdBuild && process.env.NEXT_PUBLIC_API_URL_ALLOW_LOCAL !== "1") {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "").trim();
  const problems = [];
  if (!apiUrl) {
    problems.push("NEXT_PUBLIC_API_URL is not set");
  } else if (!/^https?:\/\//i.test(apiUrl)) {
    problems.push(
      `NEXT_PUBLIC_API_URL must start with http:// or https:// (got a value of length ${apiUrl.length})`
    );
  } else if (/(^|\/\/)(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(apiUrl)) {
    problems.push(
      "NEXT_PUBLIC_API_URL points at localhost/127.0.0.1, which resolves on each visitor's own " +
        "device and can never reach this deployment"
    );
  }
  if (problems.length) {
    // Thrown rather than process.exit(1): an immediate exit discards buffered
    // stderr when the build output is piped (CI logs), which is exactly where
    // the operator most needs to read the reason.
    throw new Error(
      "Refusing to produce a production bundle:\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n  Set NEXT_PUBLIC_API_URL to the public origin of the backend, e.g. https://api.example.com/api\n" +
        "  (or set NEXT_PUBLIC_API_URL_ALLOW_LOCAL=1 for a machine-local build)"
    );
  }
}

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = nextConfig;
