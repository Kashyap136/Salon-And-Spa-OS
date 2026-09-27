/**
 * Inline status/error banner.
 *
 * Replaces `alert()` so messages are announced by screen readers, stay visible
 * next to the control that produced them, and cannot be dismissed by an
 * unrelated Enter keypress. Errors use role="alert" (assertive), confirmations
 * use role="status" (polite) so a success message never interrupts typing.
 */
const TONES = {
  error: { bg: "rgba(193,85,74,0.15)", fg: "#E08076", role: "alert" },
  success: { bg: "rgba(79,154,106,0.15)", fg: "#7FC79A", role: "status" },
  info: { bg: "rgba(201,161,90,0.12)", fg: "#E0BD7C", role: "status" },
};

export default function Alert({ tone = "error", children, className = "" }) {
  if (!children) return null;
  const cfg = TONES[tone] || TONES.error;
  return (
    <p
      role={cfg.role}
      aria-live={cfg.role === "alert" ? "assertive" : "polite"}
      className={`text-xs px-3 py-2 break-words max-tiny:px-2 ${className}`}
      style={{ background: cfg.bg, color: cfg.fg }}
    >
      {children}
    </p>
  );
}
